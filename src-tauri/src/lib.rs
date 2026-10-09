// XON 后端:进程管理核心(M1)+ 配置持久化(M2 前置)。
// 约定:全部命令字段与 src/api.js 的 JSDoc 一一对应(camelCase)。
//
// 性能要点:
// - stdout/stderr 各一个读取任务,8KB 复用缓冲逐块读取,不做逐字节 syscall;
// - 日志经有界 mpsc(1024)汇入批量写入任务,每 50ms 至多 2 条 IPC 事件(每流 1 条),
//   高频输出进程(如 ping -t、构建日志)不会每行触发一次跨语言事件;
// - 每行零冗余拷贝:行字符串从读取任务 move 到批量任务再到事件 payload;
// - 进程注册表用 std Mutex,临界区内无 await、无 IO,锁持有时间为纳秒级;
// - 日志解码:UTF-8 探测失败即判定 GBK(中文 Windows 控制台默认码页),全程单编码,
//   避免 `ping` 等系统工具输出乱码;判定缓冲有 4KB 上限,内存有界。

use std::{
    collections::HashMap,
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::Command as StdCommand,
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use encoding_rs::{CoderResult, Decoder, GBK, UTF_8};
use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    process::{ChildStdin, Command},
    sync::{mpsc, Mutex as AsyncMutex},
    time::timeout,
};

/// 后台命令窗口不闪黑框
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
/// 为 shell 命令新开可见控制台
const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
/// 每日备份保留份数
const BACKUP_KEEP: usize = 7;
/// 日志批量发射周期
const LOG_FLUSH_MS: u64 = 50;
/// 日志通道深度:前端停滞时的背压上限
const LOG_CHANNEL_DEPTH: usize = 1024;
/// 单次批量发射的最大行数
const LOG_BATCH_MAX: usize = 512;
/// 编码探测窗口(字节);超过仍无定论则按 UTF-8 收口
const ENCODE_PROBE_WINDOW: usize = 4096;

// ---------------------------------------------------------------- 数据模型

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub groups: Vec<Group>,
    /// 不挂在任何分组下的项目(自由树的根级)
    #[serde(default)]
    pub projects: Vec<Project>,
    /// 运行方案:按场景批量启动的命令集合
    #[serde(default)]
    pub scenarios: Vec<Scenario>,
    #[serde(default)]
    pub settings: AppSettings,
}

fn default_version() -> u32 {
    1
}

fn default_theme() -> String {
    "dark".into()
}

fn default_accent() -> String {
    "#88C0D0".into()
}

fn default_log_size() -> u32 {
    12
}

fn default_ui_size() -> u32 {
    13
}

fn default_close_action() -> String {
    "minimize".into()
}

/// 界面设置(M3:主题派生 / 字体配置 / 关闭行为)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_accent")]
    pub accent: String,
    /// 界面字体;空 = 默认 IBM Plex Sans
    #[serde(default)]
    pub ui_font: String,
    /// 日志字体;空 = 默认 JetBrains Mono
    #[serde(default)]
    pub log_font: String,
    #[serde(default = "default_log_size")]
    pub log_font_size: u32,
    /// 界面字号(px,全局 rem 基准)
    #[serde(default = "default_ui_size")]
    pub ui_font_size: u32,
    /// 关闭按钮行为:minimize = 最小化到托盘,exit = 完全退出
    #[serde(default = "default_close_action")]
    pub close_action: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: default_theme(),
            accent: default_accent(),
            ui_font: String::new(),
            log_font: String::new(),
            log_font_size: default_log_size(),
            ui_font_size: default_ui_size(),
            close_action: default_close_action(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scenario {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub items: Vec<ScenarioItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioItem {
    pub project_id: String,
    pub command_id: String,
    #[serde(default)]
    pub delay_seconds: u32,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            version: default_version(),
            groups: Vec::new(),
            projects: Vec::new(),
            scenarios: Vec::new(),
            settings: AppSettings::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub collapsed: bool,
    /// 子分组:分组树可无限嵌套(与旧版 XProj 一致)
    #[serde(default)]
    pub groups: Vec<Group>,
    #[serde(default)]
    pub projects: Vec<Project>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub dir: String,
    /// 折叠命令列表(纯 UI 状态)
    #[serde(default)]
    pub collapsed: bool,
    #[serde(default)]
    pub commands: Vec<CommandSpec>,
}

fn default_shell() -> String {
    "cmd".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandSpec {
    pub id: String,
    pub name: String,
    pub cmd: String,
    #[serde(default = "default_shell")]
    pub shell: String,
    #[serde(default)]
    pub cwd: String,
    #[serde(default)]
    pub env: HashMap<String, String>,
}

/// 启动请求(前端 api.js 的 StartRequest)
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartRequest {
    pub project_id: String,
    pub command_id: String,
    pub command_name: String,
    pub cmd: String,
    #[serde(default = "default_shell")]
    pub shell: String,
    #[serde(default)]
    pub cwd: String,
    #[serde(default)]
    pub env: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartInfo {
    pub pid: u32,
    pub started_at_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunningInfo {
    pub pid: u32,
    pub project_id: String,
    pub command_id: String,
    pub command_name: String,
    pub started_at_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LogChunk {
    pid: u32,
    /// "out" | "err"
    stream: &'static str,
    ts: u64,
    lines: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProcExit {
    pid: u32,
    /// 程序退出码;被强杀或异常时可能为 null
    code: Option<i32>,
    duration_ms: u64,
}

// ---------------------------------------------------------------- Windows Job Object

#[cfg(windows)]
pub struct JobObject {
    handle: windows::Win32::Foundation::HANDLE,
}

#[cfg(windows)]
unsafe impl Send for JobObject {}
#[cfg(windows)]
unsafe impl Sync for JobObject {}

#[cfg(windows)]
impl JobObject {
    /// 创建绑定了 KILL_ON_JOB_CLOSE 的 Job Object
    /// 当 JobObject 句柄关闭(或主进程崩溃/强退)时, Windows 内核自动强杀该 Job 内全部后代进程
    pub fn create_with_kill_on_close() -> Result<Self, String> {
        use windows::Win32::Foundation::CloseHandle;
        use windows::Win32::System::JobObjects::{
            CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        };

        unsafe {
            let handle = CreateJobObjectW(None, None)
                .map_err(|e| format!("创建 Job Object 失败: {e}"))?;

            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

            if let Err(e) = SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const std::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            ) {
                let _ = CloseHandle(handle);
                return Err(format!("配置 Job Object 失败: {e}"));
            }

            Ok(Self { handle })
        }
    }

    /// 将目标进程加入当前 Job Object
    /// 后续该进程繁衍的所有子孙进程均自动归入此 Job 管理, 内核维护成员表
    pub fn assign_process(&self, pid: u32) -> Result<(), String> {
        use windows::Win32::Foundation::CloseHandle;
        use windows::Win32::System::JobObjects::AssignProcessToJobObject;
        use windows::Win32::System::Threading::{
            OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
        };

        unsafe {
            let proc_handle = OpenProcess(
                PROCESS_SET_QUOTA | PROCESS_TERMINATE | PROCESS_QUERY_INFORMATION,
                false,
                pid,
            )
            .map_err(|e| format!("打开进程句柄(PID {pid})失败: {e}"))?;

            let res = AssignProcessToJobObject(self.handle, proc_handle);
            let _ = CloseHandle(proc_handle);

            res.map_err(|e| format!("将进程 {pid} 挂入 Job Object 失败: {e}"))
        }
    }

    /// 借助内核级调用原子终止 Job 内所有活跃进程
    pub fn terminate(&self, exit_code: u32) -> Result<(), String> {
        use windows::Win32::System::JobObjects::TerminateJobObject;

        unsafe {
            TerminateJobObject(self.handle, exit_code)
                .map_err(|e| format!("终止 Job Object 失败: {e}"))
        }
    }

    /// 查询 Job 内当前活跃的进程总数
    pub fn active_processes(&self) -> u32 {
        use windows::Win32::System::JobObjects::{
            JobObjectBasicAccountingInformation, QueryInformationJobObject,
            JOBOBJECT_BASIC_ACCOUNTING_INFORMATION,
        };

        unsafe {
            let mut info = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
            let res = QueryInformationJobObject(
                Some(self.handle),
                JobObjectBasicAccountingInformation,
                &mut info as *mut _ as *mut std::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32,
                None,
            );
            if res.is_ok() {
                info.ActiveProcesses
            } else {
                0
            }
        }
    }
}

#[cfg(windows)]
impl Drop for JobObject {
    fn drop(&mut self) {
        use windows::Win32::Foundation::CloseHandle;
        unsafe {
            let _ = CloseHandle(self.handle);
        }
    }
}

// ---------------------------------------------------------------- 进程注册表

struct RunningProc {
    project_id: String,
    command_id: String,
    command_name: String,
    started_at_ms: u64,
    stdin: Arc<AsyncMutex<Option<ChildStdin>>>,
    job: Arc<JobObject>,
}

#[derive(Default)]
struct ProcessRegistry(Mutex<HashMap<u32, RunningProc>>);

// ---------------------------------------------------------------- 工具

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn data_dir() -> PathBuf {
    std::env::var("LOCALAPPDATA")
        .map(|d| PathBuf::from(d).join("xon"))
        .unwrap_or_else(|_| PathBuf::from("."))
}

// ---------------------------------------------------------------- 日志解码

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Stream {
    Out,
    Err,
}

impl Stream {
    fn as_str(self) -> &'static str {
        match self {
            Stream::Out => "out",
            Stream::Err => "err",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EncodeVerdict {
    Undecided,
    Utf8,
    Gbk,
}

/// UTF-8 非法即判 GBK;探测窗口内不定论则继续等。
/// 纯 ASCII 前缀不锁定编码(GBK 对 ASCII 兼容),直到出现合法多字节 UTF-8 或超窗。
fn probe_encoding(buf: &[u8]) -> EncodeVerdict {
    match std::str::from_utf8(buf) {
        Ok(s) => {
            if s.bytes().any(|b| b >= 0x80) || buf.len() >= ENCODE_PROBE_WINDOW {
                EncodeVerdict::Utf8
            } else {
                EncodeVerdict::Undecided
            }
        }
        Err(e) => {
            if e.error_len().is_some() {
                EncodeVerdict::Gbk
            } else if buf.len() >= ENCODE_PROBE_WINDOW {
                EncodeVerdict::Utf8
            } else {
                EncodeVerdict::Undecided
            }
        }
    }
}

enum DecodeMode {
    Probe(Vec<u8>),
    Utf8(Decoder),
    Gbk(Decoder),
}

/// 行式解码器:字节块 → 完整行。探测期 ASCII 前缀即时放行,自首个非 ASCII 字节起
/// 持有原始字节(上限 4KB),判定后全程单编码。
struct LineDecoder {
    mode: DecodeMode,
    carry: String,
    /// 复用的解码输出缓冲,避免每块重新分配
    scratch: String,
}

impl LineDecoder {
    fn new() -> Self {
        Self { mode: DecodeMode::Probe(Vec::new()), carry: String::new(), scratch: String::new() }
    }

    fn feed(&mut self, chunk: &[u8], eof: bool, out: &mut Vec<String>) {
        if !matches!(self.mode, DecodeMode::Probe(_)) {
            self.decode_chunk(chunk, eof, out);
            return;
        }
        // 探测期:纯 ASCII 前缀在 GBK 与 UTF-8 下解码结果完全一致,立即放行,
        // 只从第一个非 ASCII 字节起进入探测缓冲 —— 低频输出(ping、卡在启动早期的
        // Java 进程)不会因攒不满 4KB 探测窗口而在面板上长时间一行都看不到。
        let mut pending =
            match std::mem::replace(&mut self.mode, DecodeMode::Utf8(UTF_8.new_decoder())) {
                DecodeMode::Probe(p) => p,
                _ => unreachable!("上方已确认处于探测态"),
            };
        if !pending.is_empty() {
            pending.extend_from_slice(chunk);
        } else {
            let ascii_end = chunk.iter().position(|&b| b >= 0x80).unwrap_or(chunk.len());
            let (prefix, rest) = chunk.split_at(ascii_end);
            if !prefix.is_empty() {
                self.decode_chunk(prefix, false, out);
            }
            if !rest.is_empty() {
                pending.extend_from_slice(rest);
            }
        }
        let verdict = probe_encoding(&pending);
        if verdict == EncodeVerdict::Undecided && !eof {
            self.mode = DecodeMode::Probe(pending);
            return;
        }
        // 判定成立或流已结束:按结论收口,之后全程单编码
        let bytes = std::mem::take(&mut pending);
        self.mode = if verdict == EncodeVerdict::Gbk {
            DecodeMode::Gbk(GBK.new_decoder())
        } else {
            DecodeMode::Utf8(UTF_8.new_decoder())
        };
        self.decode_chunk(&bytes, eof, out);
    }

    fn decode_chunk(&mut self, chunk: &[u8], last: bool, out: &mut Vec<String>) {
        let dec = match &mut self.mode {
            DecodeMode::Probe(_) => return,
            DecodeMode::Utf8(d) => d,
            DecodeMode::Gbk(d) => d,
        };
        self.scratch.clear();
        self.scratch.reserve(chunk.len() * 3 + 16);
        let mut src = chunk;
        loop {
            let (result, read, _) = dec.decode_to_string(src, &mut self.scratch, last);
            src = &src[read..];
            match result {
                CoderResult::InputEmpty => break,
                CoderResult::OutputFull => self.scratch.reserve(src.len() * 3 + 4096),
            }
            if src.is_empty() {
                break;
            }
        }
        self.carry.push_str(&self.scratch);
        self.split_lines(out);
    }

    fn split_lines(&mut self, out: &mut Vec<String>) {
        while let Some(pos) = self.carry.find('\n') {
            let rest = self.carry.split_off(pos + 1);
            let mut line = std::mem::replace(&mut self.carry, rest);
            trim_eol(&mut line);
            out.push(line);
        }
    }

    fn flush_tail(&mut self, out: &mut Vec<String>) {
        if !self.carry.is_empty() {
            let mut line = std::mem::take(&mut self.carry);
            trim_eol(&mut line);
            if !line.is_empty() {
                out.push(line);
            }
        }
    }
}

fn trim_eol(s: &mut String) {
    while s.ends_with('\n') || s.ends_with('\r') {
        s.pop();
    }
}

/// 单个输出流的读取任务:复用 8KB 缓冲,行文本 move 进有界通道。
async fn read_stream<R: AsyncRead + Unpin>(
    mut reader: R,
    stream: Stream,
    tx: mpsc::Sender<(Stream, String)>,
) {
    let mut raw = vec![0u8; 8192];
    let mut dec = LineDecoder::new();
    let mut lines: Vec<String> = Vec::with_capacity(64);
    loop {
        match reader.read(&mut raw).await {
            Ok(0) => break,
            Ok(n) => {
                dec.feed(&raw[..n], false, &mut lines);
                for line in lines.drain(..) {
                    if tx.send((stream, line)).await.is_err() {
                        return; // 下游(写入任务)已结束:进程退出或前端关闭
                    }
                }
            }
            Err(_) => break,
        }
    }
    dec.feed(&[], true, &mut lines);
    dec.flush_tail(&mut lines);
    for line in lines.drain(..) {
        let _ = tx.send((stream, line)).await;
    }
}

/// 批量写入任务:把一行一行的事件合并成每流一条 IPC 事件。
async fn batch_writer(
    app: AppHandle,
    pid: u32,
    mut rx: mpsc::Receiver<(Stream, String)>,
) {
    let mut buf: Vec<(Stream, String)> = Vec::with_capacity(128);
    loop {
        match timeout(Duration::from_millis(LOG_FLUSH_MS), rx.recv()).await {
            Ok(Some(first)) => {
                buf.push(first);
                while buf.len() < LOG_BATCH_MAX {
                    match rx.try_recv() {
                        Ok(more) => buf.push(more),
                        Err(_) => break,
                    }
                }
            }
            Ok(None) => break, // 两个读取任务都已结束
            Err(_) => {}       // 50ms 到点,冲刷半批
        }
        flush_chunks(&app, pid, &mut buf);
    }
    flush_chunks(&app, pid, &mut buf);
}

fn flush_chunks(app: &AppHandle, pid: u32, buf: &mut Vec<(Stream, String)>) {
    if buf.is_empty() {
        return;
    }
    let ts = now_ms();
    let mut out_lines: Vec<String> = Vec::new();
    let mut err_lines: Vec<String> = Vec::new();
    for (stream, line) in buf.drain(..) {
        match stream {
            Stream::Out => out_lines.push(line),
            Stream::Err => err_lines.push(line),
        }
    }
    for (stream, lines) in
        [(Stream::Out, out_lines), (Stream::Err, err_lines)]
    {
        if lines.is_empty() {
            continue;
        }
        let _ = app.emit("proc:log", LogChunk { pid, stream: stream.as_str(), ts, lines });
    }
}

// ---------------------------------------------------------------- 命令

#[tauri::command]
fn load_config() -> Result<AppConfig, String> {
    let path = data_dir().join("data.json");
    if !path.exists() {
        return Ok(AppConfig::default());
    }
    let text = std::fs::read_to_string(&path)
        .map_err(|e| format!("读取配置失败: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("配置解析失败(文件未被改动): {e}"))
}

/// 原子写入:先写临时文件再改名,写一半崩溃不会损坏旧配置。
/// 每天首次保存时备份一份,保留最近 BACKUP_KEEP 份。
#[tauri::command]
fn save_config(config: AppConfig) -> Result<(), String> {
    let dir = data_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建数据目录失败: {e}"))?;
    let json = serde_json::to_vec_pretty(&config).map_err(|e| e.to_string())?;
    let tmp = dir.join("data.json.tmp");
    let target = dir.join("data.json");
    if target.exists() {
        backup_config(&dir, &json);
    }
    std::fs::write(&tmp, &json).map_err(|e| format!("写入配置失败: {e}"))?;
    std::fs::rename(&tmp, &target).map_err(|e| format!("替换配置失败: {e}"))
}

/// 导出配置到指定文件(路径由前端系统保存对话框提供)
#[tauri::command]
fn export_config(path: String, config: AppConfig) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(&config).map_err(|e| e.to_string())?;
    std::fs::write(&path, &json).map_err(|e| format!("导出失败: {e}"))
}

/// 从文件导入配置(仅解析与结构校验,由前端决定是否落盘)
#[tauri::command]
fn import_config(path: String) -> Result<AppConfig, String> {
    let text =
        std::fs::read_to_string(&path).map_err(|e| format!("读取导入文件失败: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("导入文件解析失败: {e}"))
}

/// 在新控制台窗口打开目录
#[tauri::command]
fn open_terminal(dir: String) -> Result<(), String> {
    if dir.is_empty() || !Path::new(&dir).is_dir() {
        return Err(format!("目录不存在:{dir}"));
    }
    StdCommand::new("cmd")
        .args(["/K"])
        .current_dir(&dir)
        .creation_flags(CREATE_NEW_CONSOLE)
        .spawn()
        .map_err(|e| format!("打开终端失败: {e}"))?;
    Ok(())
}

/// 枚举系统已安装字体(GDI EnumFontFamiliesExW,DEFAULT_CHARSET 去重排序)。
/// 字体选择框的数据源:Windows 装了什么,这里就能列出什么(跳过 @ 开头的竖排变体)。
#[tauri::command]
fn list_fonts() -> Vec<String> {
    #[cfg(windows)]
    {
        use std::collections::BTreeSet;
        use windows::Win32::Foundation::LPARAM;
        use windows::Win32::Graphics::Gdi::{
            EnumFontFamiliesExW, GetDC, ReleaseDC, DEFAULT_CHARSET, ENUMLOGFONTEXW, LOGFONTW,
            TEXTMETRICW,
        };

        unsafe extern "system" fn font_enum_proc(
            lf: *const LOGFONTW,
            _tm: *const TEXTMETRICW,
            _font_type: u32,
            l_param: LPARAM,
        ) -> i32 {
            unsafe {
                if lf.is_null() {
                    return 1;
                }
                // 回调第一个参数才指向 ENUMLOGFONTEXW;第二个是 TEXTMETRIC/NEWTEXTMETRIC,
                // 读它的 elfFullName 是越界访问(表现为字体名乱码)。
                // 取字体族名 lfFaceName(CSS font-family 需要的正是族名,而非全名)。
                let elf = &*(lf as *const ENUMLOGFONTEXW);
                let name: String = String::from_utf16_lossy(
                    elf.elfLogFont
                        .lfFaceName
                        .iter()
                        .take_while(|&&c| c != 0)
                        .copied()
                        .collect::<Vec<u16>>()
                        .as_slice(),
                );
                if !name.trim().is_empty() && !name.starts_with('@') {
                    let set = &mut *(l_param.0 as *mut BTreeSet<String>);
                    set.insert(name);
                }
                1
            }
        }

        let mut set: BTreeSet<String> = BTreeSet::new();
        unsafe {
            let hdc = GetDC(None);
            if hdc.is_invalid() {
                return Vec::new();
            }
            let lf = LOGFONTW {
                lfCharSet: DEFAULT_CHARSET,
                ..Default::default()
            };
            let _ = EnumFontFamiliesExW(
                hdc,
                &lf,
                Some(font_enum_proc),
                LPARAM(&mut set as *mut BTreeSet<String> as isize),
                0,
            );
            let _ = ReleaseDC(None, hdc);
        }
        return set.into_iter().collect();
    }
    #[cfg(not(windows))]
    Vec::new()
}

// ---------------------------------------------------------------- 备份

/// 每天首次保存时备份;文件名 data.backup-YYYYMMDD.json;超出保留数裁剪最旧的。
fn backup_config(dir: &Path, _new_json: &[u8]) {
    let backups = dir.join("backups");
    if std::fs::create_dir_all(&backups).is_err() {
        return;
    }
    let source = dir.join("data.json");
    let stamp = backup_stamp();
    let today = format!("data.backup-{stamp}.json");
    let dest = backups.join(&today);
    if !dest.exists() {
        let _ = std::fs::copy(&source, &dest);
        prune_backups(&backups);
    }
}

fn backup_stamp() -> String {
    let days = (now_ms() / 86_400_000) as i64;
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}{m:02}{d:02}")
}

/// 从备份目录保留最近 BACKUP_KEEP 份
fn prune_backups(backups: &Path) {
    let mut stamps: Vec<String> = std::fs::read_dir(backups)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .filter_map(|e| e.file_name().into_string().ok())
                .filter_map(|name| {
                    name.strip_prefix("data.backup-")
                        .and_then(|s| s.strip_suffix(".json"))
                        .map(str::to_string)
                })
                .collect()
        })
        .unwrap_or_default();
    stamps.sort();
    stamps.reverse();
    for old in stamps.into_iter().skip(BACKUP_KEEP) {
        let _ = std::fs::remove_file(backups.join(format!("data.backup-{old}.json")));
    }
}

/// 天数 → (年, 月, 日),Howard Hinnant 的 civil_from_days 算法,避免引入 chrono
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// 读取 Windows 系统最新的用户与系统环境变量快照 (调用 userenv.dll CreateEnvironmentBlock)
/// 外部修改了 PATH 等环境变量时, 无需重启软件即可在下次启动命令时即时生效
#[cfg(windows)]
fn get_refreshed_environment() -> HashMap<String, String> {
    use windows::core::BOOL;
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::Security::TOKEN_QUERY;
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    #[link(name = "userenv")]
    extern "system" {
        fn CreateEnvironmentBlock(
            lpenvironment: *mut *mut u16,
            htoken: HANDLE,
            binherit: BOOL,
        ) -> BOOL;
        fn DestroyEnvironmentBlock(lpenvironment: *mut u16) -> BOOL;
    }

    let mut map = HashMap::new();
    unsafe {
        let mut token = HANDLE::default();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).is_err() {
            return map;
        }

        let mut env_ptr: *mut u16 = std::ptr::null_mut();
        if CreateEnvironmentBlock(&mut env_ptr, token, true.into()).as_bool() && !env_ptr.is_null() {
            let mut curr = env_ptr;
            while *curr != 0 {
                let mut len = 0;
                while *curr.add(len) != 0 {
                    len += 1;
                }
                let slice = std::slice::from_raw_parts(curr, len);
                if let Ok(entry) = String::from_utf16(slice) {
                    if let Some(pos) = entry.find('=') {
                        if pos > 0 {
                            let key = entry[..pos].to_string();
                            let val = entry[pos + 1..].to_string();
                            map.insert(key, val);
                        }
                    }
                }
                curr = curr.add(len + 1);
            }
            let _ = DestroyEnvironmentBlock(env_ptr);
        }
        let _ = CloseHandle(token);
    }
    map
}

#[tauri::command]
async fn start_process(
    app: AppHandle,
    registry: State<'_, ProcessRegistry>,
    req: StartRequest,
) -> Result<StartInfo, String> {
    // 0. Shell 分支: 支持 Cmd 与 PowerShell (带 Bypass 策略)
    let mut command = if req.shell.eq_ignore_ascii_case("powershell") {
        let mut c = Command::new("powershell");
        c.args(["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command"])
            .raw_arg(&req.cmd);
        c
    } else {
        let mut c = Command::new("cmd");
        c.args(["/C"]).raw_arg(&req.cmd);
        c
    };

    command
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    // 1. 工作目录有效性强校验
    if !req.cwd.is_empty() {
        let cwd_path = Path::new(&req.cwd);
        if !cwd_path.is_dir() {
            return Err(format!("工作目录不存在或不是有效文件夹: {}", req.cwd));
        }
        command.current_dir(cwd_path);
    }

    // 2. 动态读取并注入 Windows 最新环境变量快照 (PATH 修改即时生效)
    #[cfg(windows)]
    {
        let refreshed = get_refreshed_environment();
        if !refreshed.is_empty() {
            command.env_clear();
            for (k, v) in refreshed {
                command.env(k, v);
            }
        }
    }

    // 3. 自定义环境变量覆盖
    for (k, v) in &req.env {
        command.env(k, v);
    }

    let job = JobObject::create_with_kill_on_close()
        .map_err(|e| format!("初始化 Job Object 失败: {e}"))?;

    let mut child = command
        .spawn()
        .map_err(|e| format!("启动失败: {e}"))?;
    let pid = child.id().ok_or("启动失败:未获得进程 ID")?;
    let started_at_ms = now_ms();

    // 立即挂入 Job Object: 从诞生微秒起纳入内核监管, 子孙进程自动归入
    job.assign_process(pid)
        .map_err(|e| format!("进程监管挂载失败: {e}"))?;
    let job_holder = Arc::new(job);

    let stdin = child.stdin.take();
    let stdin_holder = Arc::new(AsyncMutex::new(stdin));

    registry.0.lock().unwrap().insert(
        pid,
        RunningProc {
            project_id: req.project_id,
            command_id: req.command_id,
            command_name: req.command_name,
            started_at_ms,
            stdin: stdin_holder,
            job: job_holder.clone(),
        },
    );

    let stdout = child.stdout.take().expect("stdout 已声明为 piped");
    let stderr = child.stderr.take().expect("stderr 已声明为 piped");
    let (tx, rx) = mpsc::channel::<(Stream, String)>(LOG_CHANNEL_DEPTH);
    tokio::spawn(read_stream(stdout, Stream::Out, tx.clone()));
    tokio::spawn(read_stream(stderr, Stream::Err, tx.clone()));
    drop(tx);

    tokio::spawn(batch_writer(app.clone(), pid, rx));

    // 监视任务:等待退出 → 终止 Job 残留(清理孤儿进程) → 广播退出码与时长 → 移出注册表
    let app2 = app.clone();
    let job_for_monitor = job_holder.clone();
    tokio::spawn(async move {
        let code = child.wait().await.ok().and_then(|s| s.code());
        // 根进程退出后静默终止 Job 残留成员, 杜绝深层孙子进程逃逸成为僵尸
        let _ = job_for_monitor.terminate(1);
        let duration_ms = now_ms().saturating_sub(started_at_ms);
        let _ = app2.emit("proc:exit", ProcExit { pid, code, duration_ms });
        app2.state::<ProcessRegistry>().0.lock().unwrap().remove(&pid);
    });

    Ok(StartInfo { pid, started_at_ms })
}

#[tauri::command]
async fn stop_process(registry: State<'_, ProcessRegistry>, pid: u32) -> Result<bool, String> {
    let job = {
        let guard = registry.0.lock().unwrap();
        guard.get(&pid).map(|p| p.job.clone())
    };
    let Some(job) = job else {
        return Ok(false);
    };

    // 1. 内核级 TerminateJobObject: 原子终止整棵作业进程树(含所有深层后代进程)
    job.terminate(1)?;

    // 2. 排空等待(Drain): 轮询 ActiveProcesses 直到归零(上限 3s)
    // 保证 node.exe/webpack 等完全死透并释放网络端口/文件锁, 彻底杜绝重启时的 EADDRINUSE
    let deadline = std::time::Instant::now() + Duration::from_secs(3);
    while std::time::Instant::now() < deadline {
        if job.active_processes() == 0 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    Ok(true)
}

#[tauri::command]
async fn stop_all_processes(registry: State<'_, ProcessRegistry>) -> Result<(), String> {
    let jobs: Vec<Arc<JobObject>> = {
        let guard = registry.0.lock().unwrap();
        guard.values().map(|p| p.job.clone()).collect()
    };
    for job in &jobs {
        let _ = job.terminate(1);
    }
    // 等待所有任务排空
    let deadline = std::time::Instant::now() + Duration::from_secs(3);
    while std::time::Instant::now() < deadline {
        if !jobs.iter().any(|j| j.active_processes() > 0) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    Ok(())
}

/// 向运行中的进程写入一行标准输入并冲刷(末尾自动补换行)
#[tauri::command]
async fn send_input(
    registry: State<'_, ProcessRegistry>,
    pid: u32,
    text: String,
) -> Result<(), String> {
    let stdin_holder = {
        let guard = registry.0.lock().unwrap();
        guard.get(&pid).map(|p| p.stdin.clone())
    }
    .ok_or_else(|| format!("进程 {pid} 未在运行"))?;

    let mut lock = stdin_holder.lock().await;
    if let Some(stdin) = lock.as_mut() {
        let mut data = text.into_bytes();
        if !data.ends_with(b"\n") {
            data.push(b'\n');
        }
        stdin
            .write_all(&data)
            .await
            .map_err(|e| format!("写入输入失败: {e}"))?;
        stdin
            .flush()
            .await
            .map_err(|e| format!("冲刷输入失败: {e}"))?;
        Ok(())
    } else {
        Err(format!("进程 {pid} 的标准输入已关闭"))
    }
}

#[tauri::command]
fn list_running(registry: State<'_, ProcessRegistry>) -> Vec<RunningInfo> {
    registry
        .0
        .lock()
        .unwrap()
        .iter()
        .map(|(pid, p)| RunningInfo {
            pid: *pid,
            project_id: p.project_id.clone(),
            command_id: p.command_id.clone(),
            command_name: p.command_name.clone(),
            started_at_ms: p.started_at_ms,
        })
        .collect()
}

// ---------------------------------------------------------------- 入口

#[cfg(test)]
mod tests {
    use super::*;

    fn lines_from(chunks: &[&[u8]]) -> Vec<String> {
        let mut dec = LineDecoder::new();
        let mut out = Vec::new();
        for chunk in chunks {
            dec.feed(chunk, false, &mut out);
        }
        dec.feed(b"", true, &mut out);
        dec.flush_tail(&mut out);
        out
    }

    /// 面板空白问题的回归:纯 ASCII 低频输出必须逐块立即出行,不得攒到 4KB 探测窗口。
    /// feed 返回的 out 非空即代表前端能当块收到日志行。
    #[test]
    fn ascii_lines_stream_immediately_without_probe_window() {
        let mut dec = LineDecoder::new();
        let mut out = Vec::new();
        dec.feed(b"14:37:41 [main] INFO line-1\n", false, &mut out);
        assert_eq!(out, vec!["14:37:41 [main] INFO line-1"]);
        out.clear();
        dec.feed(b"line-2\n", false, &mut out);
        assert_eq!(out, vec!["line-2"]);
        out.clear();
        // 结尾无换行的残行留在 carry,EOF 收口
        dec.feed(b"partial-tail", false, &mut out);
        assert!(out.is_empty());
        dec.feed(b"", true, &mut out);
        dec.flush_tail(&mut out);
        assert_eq!(out, vec!["partial-tail"]);
    }

    /// 多字节未完整到达前不得出行(避免把半个字符拆进两行)
    #[test]
    fn incomplete_multibyte_is_held_not_emitted() {
        let mut dec = LineDecoder::new();
        let mut out = Vec::new();
        let text = "日志中文行 ok\n".as_bytes();
        dec.feed(&text[..4], false, &mut out);
        assert!(out.is_empty(), "多字节未完整前不得出行");
        dec.feed(&text[4..], false, &mut out);
        assert_eq!(out, vec!["日志中文行 ok"]);
    }

    /// 同一行内 ASCII 与多字节混排、多字节跨块拆分:不丢字、不乱码
    #[test]
    fn mixed_ascii_and_multibyte_across_chunks() {
        let line = "abc中文def\n".as_bytes();
        let lines = lines_from(&[&line[..5], &line[5..]]);
        assert_eq!(lines, vec!["abc中文def".to_string()]);
    }

    /// GBK 双字节跨块拆分:第二字节也要正确重组
    #[test]
    fn gbk_multibyte_split_across_chunks() {
        let (raw, _, had_errors) = GBK.encode("中ab\n");
        assert!(!had_errors);
        let lines = lines_from(&[&raw[..1], &raw[1..]]);
        assert_eq!(lines, vec!["中ab".to_string()]);
    }

    #[test]
    fn gbk_output_decodes_to_readable_lines() {
        // 中文 Windows 控制台(ping 等)默认 GBK:UTF-8 非法序列应判定 GBK 而非乱码
        let (bytes, _, _) = GBK.encode("来自 127.0.0.1 的回复: 字节=32");
        let lines = lines_from(&[&bytes]);
        assert_eq!(lines, vec!["来自 127.0.0.1 的回复: 字节=32".to_string()]);
    }

    #[test]
    fn ascii_prefix_then_gbk_still_gbk() {
        // 纯 ASCII 前缀不锁定编码,后续 GBK 中文仍正确判定
        let (bytes, _, _) = GBK.encode("回复来自");
        let mut chunk = b"Pinging 127.0.0.1 with ".to_vec();
        chunk.extend_from_slice(&bytes);
        let lines = lines_from(&[&chunk]);
        assert_eq!(lines, vec!["Pinging 127.0.0.1 with 回复来自".to_string()]);
    }

    #[test]
    fn utf8_multibyte_commits_utf8() {
        let lines = lines_from(&["npm warn 包名已存在".as_bytes()]);
        assert_eq!(lines, vec!["npm warn 包名已存在".to_string()]);
    }

    #[test]
    fn lines_split_across_chunk_boundaries() {
        let lines = lines_from(&[b"hello ", b"world\nnext\n"]);
        assert_eq!(lines, vec!["hello world".to_string(), "next".to_string()]);
    }

    #[test]
    fn tail_without_newline_is_flushed_at_eof() {
        let lines = lines_from(&[b"abc"]);
        assert_eq!(lines, vec!["abc".to_string()]);
    }

    #[test]
    fn crlf_is_trimmed() {
        let lines = lines_from(&[b"a\r\nb\r\n"]);
        assert_eq!(lines, vec!["a".to_string(), "b".to_string()]);
    }

    #[tokio::test]
    async fn read_stream_captures_process_output() {
        let mut child = Command::new("cmd")
            .args(["/C"])
            .raw_arg("echo line1&echo line2")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .spawn()
            .unwrap();
        let stdout = child.stdout.take().unwrap();
        let (tx, mut rx) = mpsc::channel(16);
        tokio::spawn(read_stream(stdout, Stream::Out, tx));
        let mut lines = Vec::new();
        while let Some((_, line)) = rx.recv().await {
            lines.push(line);
        }
        child.wait().await.unwrap();
        assert_eq!(lines, vec!["line1", "line2"]);
    }

    #[tokio::test]
    async fn raw_arg_with_quotes_and_ascii_stream() {
        let cmd = "echo \"15:21:45.166 [main] INFO auth\"";
        let mut child = Command::new("cmd")
            .args(["/C"])
            .raw_arg(cmd)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .spawn()
            .unwrap();
        let stdout = child.stdout.take().unwrap();
        let (tx, mut rx) = mpsc::channel(16);
        tokio::spawn(read_stream(stdout, Stream::Out, tx));
        let mut lines = Vec::new();
        while let Some((_, line)) = rx.recv().await {
            lines.push(line);
        }
        child.wait().await.unwrap();
        assert_eq!(lines, vec!["\"15:21:45.166 [main] INFO auth\""]);
    }

    /// 管道持活: 只要 stdin 句柄保持打开, 依赖输入的命令(如 set /p 或 wsl/bash)就不会因 EOF 提前退出
    #[tokio::test]
    async fn piped_stdin_kept_open_prevents_premature_exit() {
        let mut child = Command::new("cmd")
            .args(["/C"])
            .raw_arg("set /p test_in=")
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .unwrap();

        let stdin = child.stdin.take().unwrap();
        // 验证: 在 stdin 未关闭期间, 进程正常阻塞等待, 不会瞬间秒退
        let exit_check = timeout(Duration::from_millis(150), child.wait()).await;
        assert!(exit_check.is_err(), "held open stdin must keep the process waiting");

        // 主动释放 stdin(发送 EOF), 进程得以正常结束
        drop(stdin);
        let exit_res = timeout(Duration::from_millis(1500), child.wait()).await;
        assert!(exit_res.is_ok(), "closing stdin allows the process to finish");
    }

    /// Windows Job Object 治理: 挂入 Job 的进程及其子孙进程会被原子终止且排空
    #[tokio::test]
    async fn job_object_manages_and_terminates_process_tree() {
        let job = JobObject::create_with_kill_on_close().unwrap();

        // 启动一个双层 cmd 进程树: cmd /C "cmd /C set /p nested="
        let child = Command::new("cmd")
            .args(["/C"])
            .raw_arg("cmd /C set /p nested=")
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .unwrap();

        let pid = child.id().unwrap();
        job.assign_process(pid).unwrap();

        // 等待子进程树生成
        tokio::time::sleep(Duration::from_millis(100)).await;

        // 验证 Job 中至少有活跃进程
        assert!(job.active_processes() >= 1);

        // 调用 terminate(1) 原子终止整棵树
        job.terminate(1).unwrap();

        // 验证排空: ActiveProcesses 应归零
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        let mut drained = false;
        while std::time::Instant::now() < deadline {
            if job.active_processes() == 0 {
                drained = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        assert!(drained, "Job Object 内所有进程必须排空清零");
    }

    // 诊断字体枚举输出(跑:npm run tauri 之外的 cargo test list_fonts -- --nocapture)
    #[test]
    fn list_fonts_diagnostic() {
        let fonts = list_fonts();
        println!("font count = {}", fonts.len());
        for name in fonts.iter().take(25) {
            println!("font: {:?}", name);
        }
    }
}

// ---------------------------------------------------------------- 窗口 / 托盘 / 退出

fn show_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

/// 从磁盘读关闭行为设置;读不到时按"最小化到托盘"处理
fn current_close_action() -> String {
    let path = data_dir().join("data.json");
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<AppConfig>(&text).ok())
        .map(|c| c.settings.close_action)
        .unwrap_or_else(default_close_action)
}

/// 去浏览器味:直调 WebView2 Settings,关闭原生右键菜单、自动填充、缩放、
/// 滑动导航与浏览器加速键(发布版);dev 保留加速键(F12/F5 调试不受影响)。
#[cfg(windows)]
fn harden_webview(webview: tauri::webview::PlatformWebview) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Settings, ICoreWebView2Settings2, ICoreWebView2Settings3,
        ICoreWebView2Settings4, ICoreWebView2Settings5, ICoreWebView2Settings6,
    };
    use windows_core::Interface;

    unsafe {
        let controller = webview.controller();
        let Ok(core) = controller.CoreWebView2() else { return };
        let Ok(settings) = core.Settings() else { return };
        let s: ICoreWebView2Settings = settings.cast().expect("webview settings");

        let _ = s.SetAreDefaultContextMenusEnabled(false);
        let _ = s.SetIsStatusBarEnabled(false);
        if let Ok(s2) = settings.cast::<ICoreWebView2Settings2>() {
            let _ = s2.SetIsZoomControlEnabled(false); // Ctrl+滚轮缩放
        }
        if let Ok(s3) = settings.cast::<ICoreWebView2Settings3>() {
            // F5/Ctrl+R/Ctrl+P 等浏览器加速键:发布版关闭,开发版保留以便调试
            let _ = s3.SetAreBrowserAcceleratorKeysEnabled(cfg!(debug_assertions));
        }
        if let Ok(s4) = settings.cast::<ICoreWebView2Settings4>() {
            let _ = s4.SetIsGeneralAutofillEnabled(false); // 表单自动填充
        }
        if let Ok(s5) = settings.cast::<ICoreWebView2Settings5>() {
            let _ = s5.SetIsPinchZoomEnabled(false); // 触控板捏合缩放
        }
        if let Ok(s6) = settings.cast::<ICoreWebView2Settings6>() {
            let _ = s6.SetIsSwipeNavigationEnabled(false); // 滑动前进/后退
        }
    }
}

/// 退出前停掉所有运行中的进程树(同步:原子调用内核 TerminateJobObject)
fn stop_all_sync(app: &AppHandle) {
    let registry = app.state::<ProcessRegistry>();
    let jobs: Vec<Arc<JobObject>> = {
        let guard = registry.0.lock().unwrap();
        guard.values().map(|p| p.job.clone()).collect()
    };
    for job in jobs {
        let _ = job.terminate(1);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 单实例:二次启动时唤起已有窗口(M2)
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(ProcessRegistry::default())
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_config,
            export_config,
            import_config,
            start_process,
            stop_process,
            stop_all_processes,
            list_running,
            open_terminal,
            list_fonts,
            send_input
        ])
        .setup(|app| {
            // 品牌图标: 显式从打包内联资源解码 PNG, 规避 Windows 开发环境 PE 资源表查询失败导致 None
            let app_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/128x128.png"))
                .ok()
                .or_else(|| app.default_window_icon().cloned());
            let tray_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))
                .ok()
                .or_else(|| app_icon.clone());

            // 去浏览器味(Windows:直调 WebView2 Settings)并显式设置窗口与任务栏图标
            if let Some(main) = app.get_webview_window("main") {
                #[cfg(windows)]
                let _ = main.with_webview(harden_webview);
                if let Some(ref icon) = app_icon {
                    let _ = main.set_icon(icon.clone());
                }
                let _ = &main;
            }

            // 系统托盘:左键唤起主窗口,菜单提供显示/完全退出
            let show = MenuItem::with_id(app, "show", "显示 XON", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "完全退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let mut tray = TrayIconBuilder::with_id("xon-tray")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("XON")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main(app),
                    "quit" => {
                        stop_all_sync(app);
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                });
            if let Some(ref icon) = tray_icon {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // 关闭行为:最小化到托盘(默认)或完全退出
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" && current_close_action() != "exit" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                stop_all_sync(app);
            }
        });
}
