// 跨语言调用统一收口:所有 invoke / listen 只允许出现在这里。
// 每个导出函数的参数与返回结构 Rust 侧结构体一一对应(见 src-tauri/src/lib.rs)。
//
// 浏览器预览:`npm run dev` 直接开浏览器时没有 Tauri 环境,自动切换到 mock 后端,
// 用于纯前端开发与视觉验收;不影响打包(Tauri 内运行时走真实实现)。

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as dialogOpen, save as dialogSave } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";

/** 是否运行在 Tauri WebView 内 */
export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** @typedef {{version: number, groups: Group[], projects: Project[], scenarios: Scenario[], settings: AppSettings}} AppConfig */
/** @typedef {{id: string, name: string, collapsed?: boolean, groups?: Group[], projects: Project[]}} Group */
/** @typedef {{id: string, name: string, dir: string, commands: CommandSpec[]}} Project */
/** @typedef {{id: string, name: string, cmd: string, shell?: 'cmd'|'powershell', cwd?: string, env?: Record<string, string>}} CommandSpec */
/** @typedef {{id: string, name: string, items: ScenarioItem[]}} Scenario */
/** @typedef {{projectId: string, commandId: string, delaySeconds?: number}} ScenarioItem */
/** @typedef {{theme: 'dark'|'light', accent: string, uiFont: string, logFont: string, logFontSize: number, uiFontSize: number, closeAction: 'minimize'|'exit'}} AppSettings */
/** @typedef {{pid: number, projectId: string, commandId: string, commandName: string, startedAtMs: number}} RunningInfo */
/** @typedef {{pid: number, projectId: string, commandId: string, commandName: string, cmd: string, shell?: string, cwd: string, env: Record<string, string>}} StartRequest */
/** @typedef {{pid: number, startedAtMs: number}} StartInfo */
/** @typedef {{pid: number, stream: 'out'|'err', ts: number, lines: string[]}} LogChunk */
/** @typedef {{pid: number, code: number|null, durationMs: number}} ProcExit */

/**
 * 读取 %LOCALAPPDATA%\xon\data.json;不存在时返回 { version: 1, groups: [] }。
 * @returns {Promise<AppConfig>}
 */
export function loadConfig() {
  return impl.loadConfig();
}

/**
 * 全量保存配置(原子写:临时文件 + rename)。
 * @param {AppConfig} config
 * @returns {Promise<void>}
 */
export function saveConfig(config) {
  return impl.saveConfig(config);
}

/**
 * 以 `cmd /C <cmd>` 启动一条命令,进程树任务杀由 stopProcess 负责。
 * @param {StartRequest} req
 * @returns {Promise<StartInfo>}
 */
export function startProcess(req) {
  return impl.startProcess(req);
}

/**
 * `taskkill /PID <pid> /T /F` 回收整棵进程树(M1 过渡方案)。
 * @param {number} pid
 * @returns {Promise<boolean>} true = 已下发停止;false = 进程不在运行表中
 */
export function stopProcess(pid) {
  return impl.stopProcess(pid);
}

/**
 * 向运行中的进程写入一行标准输入并冲刷。
 * @param {number} pid
 * @param {string} text
 * @returns {Promise<void>}
 */
export function sendInput(pid, text) {
  return impl.sendInput(pid, text);
}

/** 停掉当前所有运行中的进程树。 @returns {Promise<void>} */
export function stopAllProcesses() {
  return impl.stopAllProcesses();
}

/** 列出运行中的进程(前端刷新后恢复状态用)。 @returns {Promise<RunningInfo[]>} */
export function listRunning() {
  return impl.listRunning();
}

/**
 * 导出配置到指定 JSON 文件。
 * @param {string} path 系统保存对话框返回的绝对路径
 * @param {AppConfig} config
 * @returns {Promise<void>}
 */
export function exportConfig(path, config) {
  return impl.exportConfig(path, config);
}

/**
 * 从 JSON 文件读取配置(仅解析校验,不落盘)。
 * @param {string} path 系统打开对话框返回的绝对路径
 * @returns {Promise<AppConfig>}
 */
export function importConfig(path) {
  return impl.importConfig(path);
}

/** 系统保存对话框;返回所选绝对路径,取消返回 null。 @returns {Promise<string|null>} */
export function pickSavePath() {
  return impl.pickSavePath();
}

/** 系统打开对话框;返回所选绝对路径,取消返回 null。 @returns {Promise<string|null>} */
export function pickOpenPath() {
  return impl.pickOpenPath();
}

/** 系统文件夹选择对话框;返回所选目录绝对路径,取消返回 null。 @returns {Promise<string|null>} */
export function pickFolder() {
  return impl.pickFolder();
}

/**
 * 用资源管理器打开目录。
 * @param {string} dir
 * @returns {Promise<void>}
 */
export function openDirInExplorer(dir) {
  return impl.openDirInExplorer(dir);
}

/**
 * 在新控制台窗口打开项目目录。
 * @param {string} dir
 * @returns {Promise<void>}
 */
export function openTerminal(dir) {
  return impl.openTerminal(dir);
}

/**
 * 枚举系统已安装字体(GDI,含所有 Windows 安装字体)。
 * @returns {Promise<string[]>} 字体族名列表,已排序去重
 */
export function listFonts() {
  return impl.listFonts();
}

/**
 * 订阅日志流(后端已按 50ms / 每流一条批量打包)。
 * @param {(chunk: LogChunk) => void} cb
 * @returns {Promise<() => void>} unlisten
 */
export function onProcLog(cb) {
  return impl.onProcLog(cb);
}

/**
 * 订阅进程退出(含退出码与运行时长)。
 * @param {(exit: ProcExit) => void} cb
 * @returns {Promise<() => void>} unlisten
 */
export function onProcExit(cb) {
  return impl.onProcExit(cb);
}

// ---------------------------------------------------------------- Tauri 实现

const tauriImpl = {
  loadConfig: () => invoke("load_config"),
  saveConfig: (config) => invoke("save_config", { config }),
  startProcess: (req) => invoke("start_process", { req }),
  stopProcess: (pid) => invoke("stop_process", { pid }),
  sendInput: (pid, text) => invoke("send_input", { pid, text }),
  stopAllProcesses: () => invoke("stop_all_processes"),
  listRunning: () => invoke("list_running"),
  exportConfig: (path, config) => invoke("export_config", { path, config }),
  importConfig: (path) => invoke("import_config", { path }),
  pickSavePath: () =>
    dialogSave({
      title: "导出配置",
      defaultPath: "xon-config.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    }),
  pickOpenPath: () =>
    dialogOpen({
      title: "导入配置",
      multiple: false,
      filters: [{ name: "JSON", extensions: ["json"] }],
    }),
  pickFolder: () =>
    dialogOpen({
      title: "选择目录",
      directory: true,
      multiple: false,
    }),
  openTerminal: (dir) => invoke("open_terminal", { dir }),
  openDirInExplorer: (dir) => openPath(dir),
  listFonts: () => invoke("list_fonts"),
  onProcLog: (cb) => listen("proc:log", (e) => cb(e.payload)),
  onProcExit: (cb) => listen("proc:exit", (e) => cb(e.payload)),
};

// ---------------------------------------------------------------- 浏览器 mock

function createMockImpl() {
  const emitLogSubs = [];
  const emitExitSubs = [];
  const running = new Map(); // pid -> { req, startedAtMs, timer }
  let nextPid = 48120;

  /** @type {AppConfig} */
  let config = {
    version: 1,
    groups: [
      {
        id: "g-demo",
        name: "示例分组",
        groups: [
          {
            id: "g-sub",
            name: "子分组(可无限嵌套)",
            groups: [],
            projects: [
              {
                id: "p-sub",
                name: "嵌套项目",
                dir: "D:\\projects\\private\\xon",
                commands: [{ id: "c-sub", name: "嵌套命令", cmd: "echo hello from nested", cwd: "", env: {} }],
              },
            ],
          },
        ],
        projects: [
          {
            id: "p-demo",
            name: "演示项目",
            dir: "D:\\projects\\private\\xon",
            commands: [
              { id: "c-ping", name: "ping 测试", cmd: "ping 127.0.0.1 -n 30", cwd: "", env: {} },
              { id: "c-dir", name: "目录内容", cmd: "dir /b", cwd: "", env: {} },
            ],
          },
        ],
      },
    ],
    projects: [
      {
        id: "p-root",
        name: "根级项目",
        dir: "D:\\projects\\private\\xon",
        commands: [{ id: "c-root", name: "列目录", cmd: "dir", cwd: "", env: {} }],
      },
    ],
    scenarios: [
      {
        id: "s-demo",
        name: "日常启动",
        items: [{ projectId: "p-demo", commandId: "c-ping" }],
      },
    ],
    settings: {
      theme: "dark",
      accent: "#88C0D0",
      uiFont: "",
      logFont: "",
      logFontSize: 12,
      closeAction: "minimize",
    },
  };

  function emitLog(chunk) {
    emitLogSubs.forEach((cb) => cb(chunk));
  }
  function emitExit(exit) {
    emitExitSubs.forEach((cb) => cb(exit));
  }

  function simulate(req, pid) {
    let n = 0;
    const total = 12 + Math.floor(Math.random() * 8);
    const timer = setInterval(() => {
      const entry = running.get(pid);
      if (!entry) return;
      n += 1;
      if (n % 3 === 0) {
        emitLog({ pid, stream: "err", ts: Date.now(), lines: [`[stderr] mock 警告行 ${n}/${total}`] });
      }
      emitLog({
        pid,
        stream: "out",
        ts: Date.now(),
        lines: [`${new Date().toLocaleTimeString("zh-CN", { hour12: false })}  [mock] ${req.cmd} 输出行 ${n}/${total}`],
      });
      if (n >= total) {
        clearInterval(timer);
        running.delete(pid);
        emitExit({ pid, code: 0, durationMs: n * 300 });
      }
    }, 300);
    return timer;
  }

  return {
    async loadConfig() {
      return JSON.parse(JSON.stringify(config));
    },
    async saveConfig(next) {
      config = JSON.parse(JSON.stringify(next));
    },
    async startProcess(req) {
      const pid = nextPid++;
      const startedAtMs = Date.now();
      running.set(pid, { req, startedAtMs, timer: simulate(req, pid) });
      return { pid, startedAtMs };
    },
    async stopProcess(pid) {
      const entry = running.get(pid);
      if (!entry) return false;
      clearInterval(entry.timer);
      running.delete(pid);
      emitExit({ pid, code: 1, durationMs: Date.now() - entry.startedAtMs });
      return true;
    },
    async sendInput(pid, text) {
      console.log(`[mock] sendInput to pid ${pid}:`, text);
    },
    async stopAllProcesses() {
      for (const pid of [...running.keys()]) await this.stopProcess(pid);
    },
    async listRunning() {
      return [...running.entries()].map(([pid, e]) => ({
        pid,
        projectId: e.req.projectId,
        commandId: e.req.commandId,
        commandName: e.req.commandName,
        startedAtMs: e.startedAtMs,
      }));
    },
    async exportConfig(path, cfg) {
      window.alert(`[mock] 已导出到 ${path}(${cfg.groups.length} 个分组)`);
    },
    async importConfig(path) {
      const raw = window.prompt(`[mock] 读取导入文件:\n${path}\n(浏览器预览直接沿用当前配置)`);
      if (raw == null) throw new Error("导入已取消");
      return JSON.parse(JSON.stringify(config));
    },
    async pickSavePath() {
      return window.prompt("[mock] 保存路径", "D:\\desktop\\xon-config.json");
    },
    async pickOpenPath() {
      return window.prompt("[mock] 打开路径", "D:\\desktop\\xon-config.json");
    },
    async pickFolder() {
      return window.prompt("[mock] 选择目录", "D:\\projects\\private");
    },
    async openTerminal(dir) {
      window.alert(`[mock] 在终端打开:${dir}`);
    },
    async listFonts() {
      return ["IBM Plex Sans", "Segoe UI", "Segoe UI Variable Text", "Microsoft YaHei", "JetBrains Mono", "Cascadia Mono", "Consolas", "SimSun", "Microsoft JhengHei"];
    },
    async openDirInExplorer(dir) {
      window.alert(`[mock] 在资源管理器打开:${dir}`);
    },
    async onProcLog(cb) {
      emitLogSubs.push(cb);
      return () => emitLogSubs.splice(emitLogSubs.indexOf(cb), 1);
    },
    async onProcExit(cb) {
      emitExitSubs.push(cb);
      return () => emitExitSubs.splice(emitExitSubs.indexOf(cb), 1);
    },
  };
}

const impl = isTauri ? tauriImpl : createMockImpl();
