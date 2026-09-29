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
    sync::Mutex,
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
    io::{AsyncRead, AsyncReadExt},
    process::Command,
    sync::mpsc,
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
    "#22C55E".into()
}

fn default_log_size() -> u32 {
    12
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
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            version: default_version(),
            groups: Vec::new(),
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
    #[serde(default)]
    pub commands: Vec<CommandSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandSpec {
    pub id: String,
    pub name: String,
    pub cmd: String,
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

// ---------------------------------------------------------------- 进程注册表

struct RunningProc {
    project_id: String,
    command_id: String,
    command_name: String,
    started_at_ms: u64,
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

/// 行式解码器:字节块 → 完整行。探测期持有原始字节(上限 4KB),判定后全程单编码。
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
        if let DecodeMode::Probe(pending) = &mut self.mode {
            pending.extend_from_slice(chunk);
            let verdict = probe_encoding(pending);
            if verdict == EncodeVerdict::Undecided && !eof {
                return;
            }
            let bytes = std::mem::take(pending);
            self.mode = if verdict == EncodeVerdict::Gbk {
                DecodeMode::Gbk(GBK.new_decoder())
            } else {
                DecodeMode::Utf8(UTF_8.new_decoder())
            };
            self.decode_chunk(&bytes, eof, out);
            return;
        }
        self.decode_chunk(chunk, eof, out);
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
            let (result, read, _, _) = dec.decode_to_str(src, &mut self.scratch, last);
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

/// 用 VSCode 打开目录(需 `code` 在 PATH 中)
#[tauri::command]
fn open_vscode(dir: String) -> Result<(), String> {
    if dir.is_empty() || !Path::new(&dir).is_dir() {
        return Err(format!("目录不存在:{dir}"));
    }
    StdCommand::new("cmd")
        .args(["/C", "code", &dir])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|_| "打开 VSCode 失败:未安装或 code 不在 PATH 中".to_string())?;
    Ok(())
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

#[tauri::command]
async fn start_process(
    app: AppHandle,
    registry: State<'_, ProcessRegistry>,
    req: StartRequest,
) -> Result<StartInfo, String> {
    let mut command = Command::new("cmd");
    command
        .args(["/C"])
        .raw_arg(&req.cmd)
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    if !req.cwd.is_empty() {
        command.current_dir(&req.cwd);
    }
    for (k, v) in &req.env {
        command.env(k, v);
    }

    let mut child = command
        .spawn()
        .map_err(|e| format!("启动失败: {e}"))?;
    let pid = child.id().ok_or("启动失败:未获得进程 ID")?;
    let started_at_ms = now_ms();

    registry.0.lock().unwrap().insert(
        pid,
        RunningProc {
            project_id: req.project_id,
            command_id: req.command_id,
            command_name: req.command_name,
            started_at_ms,
        },
    );

    let stdout = child.stdout.take().expect("stdout 已声明为 piped");
    let stderr = child.stderr.take().expect("stderr 已声明为 piped");
    let (tx, rx) = mpsc::channel::<(Stream, String)>(LOG_CHANNEL_DEPTH);
    tokio::spawn(read_stream(stdout, Stream::Out, tx.clone()));
    tokio::spawn(read_stream(stderr, Stream::Err, tx.clone()));
    drop(tx);

    tokio::spawn(batch_writer(app.clone(), pid, rx));

    // 监视任务:等待退出 → 广播退出码与时长 → 移出注册表
    let app2 = app.clone();
    tokio::spawn(async move {
        let code = child.wait().await.ok().and_then(|s| s.code());
        let duration_ms = now_ms().saturating_sub(started_at_ms);
        let _ = app2.emit("proc:exit", ProcExit { pid, code, duration_ms });
        app2.state::<ProcessRegistry>().0.lock().unwrap().remove(&pid);
    });

    Ok(StartInfo { pid, started_at_ms })
}

#[tauri::command]
async fn stop_process(registry: State<'_, ProcessRegistry>, pid: u32) -> Result<bool, String> {
    let exists = registry.0.lock().unwrap().contains_key(&pid);
    if !exists {
        return Ok(false);
    }
    kill_tree(pid).await?;
    Ok(true)
}

#[tauri::command]
async fn stop_all_processes(registry: State<'_, ProcessRegistry>) -> Result<(), String> {
    let pids: Vec<u32> = registry.0.lock().unwrap().keys().copied().collect();
    for pid in pids {
        let _ = kill_tree(pid).await;
    }
    Ok(())
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

/// taskkill /T /F:回收整棵进程树(M1 过渡方案,M2 起换 Job Object)。
/// 退出码 128 = 进程不存在,视为已停止成功。
async fn kill_tree(pid: u32) -> Result<(), String> {
    let out = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .await
        .map_err(|e| format!("taskkill 启动失败: {e}"))?;
    if out.status.code() == Some(128) || out.status.success() {
        Ok(())
    } else {
        Err(format!("停止进程 {pid} 失败:{}", String::from_utf8_lossy(&out.stderr).trim()))
    }
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
        out
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

/// 退出前停掉所有运行中的进程树(同步:退出路径里不能 await)
fn stop_all_sync(app: &AppHandle) {
    let pids: Vec<u32> = app
        .state::<ProcessRegistry>()
        .0
        .lock()
        .unwrap()
        .keys()
        .copied()
        .collect();
    for pid in pids {
        let _ = StdCommand::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
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
            open_vscode
        ])
        .setup(|app| {
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
            if let Some(icon) = app.default_window_icon() {
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
