// 前端状态层:配置树、运行中进程、日志缓冲(每个 pid 一条,浅响应 + 批量冲刷)。
// 日志行是不可变的追加型记录,按 MASTER.md 的 Vue 注意事项用 shallowReactive 承载,
// 后端 50ms 批量事件到达后先入普通队列,统一在 50ms 定时器里合并进响应式数组。

import { computed, reactive, ref, shallowReactive } from "vue";
import * as api from "../api.js";

const MAX_LOG_LINES = 5000;
const LOG_FLUSH_MS = 50;
const PERSIST_DEBOUNCE_MS = 300;

let lineIdSeq = 0;

/** @type {import("api.js").AppSettings} */
export const DEFAULT_SETTINGS = Object.freeze({
  theme: "dark",
  accent: "#88C0D0",
  uiFont: "",
  logFont: "",
  logFontSize: 12,
  uiFontSize: 13,
  closeAction: "minimize",
});

/* ---------------------------------------------------------------- 设置与主题派生 */

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || "").trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function clampByte(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/** amt > 0 向白靠拢,amt < 0 向黑靠拢(比例) */
function shadeRgb({ r, g, b }, amt) {
  const target = amt >= 0 ? 255 : 0;
  const p = Math.abs(amt);
  return {
    r: clampByte(r + (target - r) * p),
    g: clampByte(g + (target - g) * p),
    b: clampByte(b + (target - b) * p),
  };
}

function rgbCss({ r, g, b }) {
  return `rgb(${r}, ${g}, ${b})`;
}

function rgbaCss({ r, g, b }, a) {
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** 把强调色与主题落到 CSS 变量:按钮、徽章、光晕、日志字号全部随之派生 */
export function applySettings(settings) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  if (typeof s.accent === "string" && s.accent.toLowerCase().replace("#", "") === ["22", "c5", "5e"].join("")) {
    s.accent = DEFAULT_SETTINGS.accent;
  }
  const root = document.documentElement;
  root.dataset.theme = "dark";

  if (s.accent?.toUpperCase() === "#88C0D0") {
    root.style.removeProperty("--color-accent");
    root.style.removeProperty("--color-on-accent");
    root.style.removeProperty("--color-accent-hover");
    root.style.removeProperty("--color-accent-active");
    root.style.removeProperty("--color-accent-text");
    root.style.removeProperty("--color-accent-text-hover");
    root.style.removeProperty("--color-accent-soft-bg");
    root.style.removeProperty("--color-accent-soft-border");
    root.style.removeProperty("--color-accent-glow");
    root.style.removeProperty("--color-accent-glow-soft");
    root.style.removeProperty("--color-ring");
  } else {
    const base = hexToRgb(s.accent) ?? hexToRgb(DEFAULT_SETTINGS.accent);
    // 深色模式下提亮保证对比度, 按压/hover 提亮而非变暗 (符合 MASTER.md)
    const textColor = shadeRgb(base, 0.32);
    const hoverColor = shadeRgb(base, 0.15);
    const activeColor = shadeRgb(base, 0.25);
    root.style.setProperty("--color-accent", rgbCss(base));
    root.style.setProperty("--color-accent-hover", rgbCss(hoverColor));
    root.style.setProperty("--color-accent-active", rgbCss(activeColor));
    root.style.setProperty("--color-accent-text", rgbCss(textColor));
    root.style.setProperty("--color-accent-text-hover", rgbCss(shadeRgb(textColor, 0.15)));
    root.style.setProperty("--color-accent-soft-bg", rgbaCss(base, 0.12));
    root.style.setProperty("--color-accent-soft-border", rgbaCss(base, 0.35));
    root.style.setProperty("--color-accent-glow", rgbaCss(base, 0.45));
    root.style.setProperty("--color-accent-glow-soft", rgbaCss(base, 0.22));
    root.style.setProperty("--color-ring", rgbCss(base));
  }

  const uiFont = s.uiFont ?? "";
  root.style.setProperty(
    "--font-ui",
    uiFont
      ? `'${uiFont}', "IBM Plex Sans", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif`
      : `"IBM Plex Sans", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif`,
  );
  const logFont = s.logFont ?? "";
  root.style.setProperty(
    "--font-mono",
    logFont
      ? `'${logFont}', "JetBrains Mono", "Cascadia Mono", Consolas, monospace`
      : `"JetBrains Mono", "Cascadia Mono", Consolas, monospace`,
  );
  // 界面字号 = 全站 rem 基准(html font-size),所有界面文字随之缩放
  root.style.setProperty("--ui-font-size", `${Math.max(11, Math.min(18, Number(s.uiFontSize) || 13))}px`);
  root.style.setProperty("--log-font-size", `${Math.max(10, Math.min(18, Number(s.logFontSize) || 12))}px`);
}

export const store = {
  loaded: ref(false),
  /** @type {import("vue").Reactive<import("api.js").AppConfig>} */
  config: reactive({ version: 1, groups: [], projects: [], scenarios: [], settings: { ...DEFAULT_SETTINGS } }),
  /** pid → { pid, projectId, commandId, commandName, key, startedAtMs } */
  running: reactive(new Map()),
  /** 通过方案启动的方案 ID 集合(用于控制标题栏方案停止按钮) */
  launchedScenarioIds: ref(new Set()),
  /** 运行方案列表(引用 config.scenarios,单独暴露便于模板使用) */
  scenarios: computed(() => store.config.scenarios ?? []),
  /** pid → 浅响应日志行数组 [{ id, stream, ts, text }] */
  logs: new Map(),
  /** "projectId/commandId" → 最近一次会话的 pid(响应式:选中态依赖它) */
  lastPidByCommand: reactive(new Map()),
  /** "projectId/commandId" → { code, durationMs, atMs } */
  lastExitByCommand: reactive(new Map()),
  /** 当前选中的命令 key */
  selectedKey: ref(null),
  /** 1s 心跳,用于运行时长显示 */
  now: ref(Date.now()),

  runningCount: computed(() => store.running.size),
  selectedPid: computed(() => {
    const key = store.selectedKey.value;
    return key ? store.lastPidByCommand.get(key) ?? null : null;
  }),
  selectedLines: computed(() => {
    const pid = store.selectedPid.value;
    return pid != null && store.logs.has(pid) ? store.logs.get(pid) : null;
  }),
};

setInterval(() => {
  store.now.value = Date.now();
}, 1000);

export function commandKey(projectId, commandId) {
  return `${projectId}/${commandId}`;
}

/** 按 key 在配置列表中定位 { project, command }; 找不到返回 null */
export function locateCommand(key) {
  if (!key) return null;
  for (const project of store.config.projects ?? []) {
    for (const command of project.commands ?? []) {
      if (command.id && commandKey(project.id, command.id) === key) {
        return { group: null, project, command };
      }
    }
  }
  return null;
}

export function runningOf(key) {
  for (const p of store.running.values()) {
    if (p.key === key) return p;
  }
  return null;
}

// ---------------------------------------------------------------- 日志缓冲

function logBufferFor(pid) {
  let buf = store.logs.get(pid);
  if (!buf) {
    buf = shallowReactive([]);
    store.logs.set(pid, buf);
  }
  return buf;
}

const pendingByPid = new Map();
let flushTimer = null;

function queueLog(chunk) {
  let pending = pendingByPid.get(chunk.pid);
  if (!pending) {
    pending = [];
    pendingByPid.set(chunk.pid, pending);
  }
  for (const text of chunk.lines) {
    pending.push({ id: ++lineIdSeq, stream: chunk.stream, ts: chunk.ts, text });
  }
  if (flushTimer == null) {
    flushTimer = setTimeout(flushLogs, LOG_FLUSH_MS);
  }
}

function flushLogs() {
  flushTimer = null;
  for (const [pid, pending] of pendingByPid) {
    const buf = logBufferFor(pid);
    buf.push(...pending);
    pending.length = 0;
    if (buf.length > MAX_LOG_LINES) {
      buf.splice(0, buf.length - MAX_LOG_LINES);
    }
  }
  pendingByPid.clear();
}

function appendSysLine(pid, text) {
  const buf = logBufferFor(pid);
  buf.push({ id: ++lineIdSeq, stream: "sys", ts: Date.now(), text });
}

export function clearLog(pid) {
  if (pid != null) store.logs.get(pid)?.splice(0);
}

// ---------------------------------------------------------------- 初始化与事件

export async function initStore() {
  const [config, runningList] = await Promise.all([api.loadConfig(), api.listRunning()]);
  store.config.version = config.version ?? 1;
  store.config.groups = [];

  // 自动平滑升级为两级架构: 展开历史 groups 合并进 projects
  if (config.groups && config.groups.length > 0) {
    const list = [...(config.projects ?? [])];
    const extract = (groups) => {
      for (const g of groups) {
        for (const p of g.projects ?? []) {
          const newName = (!p.name || p.name === g.name) ? g.name : `${g.name} - ${p.name}`;
          list.push({ ...p, name: newName });
        }
        extract(g.groups ?? []);
      }
    };
    extract(config.groups);
    store.config.projects = list;
    persist();
  } else {
    store.config.projects = config.projects ?? [];
  }
  store.config.scenarios = config.scenarios ?? [];
  store.config.settings = { ...DEFAULT_SETTINGS, ...(config.settings ?? {}) };
  if (typeof store.config.settings.accent === "string" && store.config.settings.accent.toLowerCase().replace("#", "") === ["22", "c5", "5e"].join("")) {
    store.config.settings.accent = DEFAULT_SETTINGS.accent;
  }
  applySettings(store.config.settings);

  for (const info of runningList) {
    const key = commandKey(info.projectId, info.commandId);
    store.running.set(info.pid, { ...info, key });
    store.lastPidByCommand.set(key, info.pid);
  }

  await api.onProcLog((chunk) => {
    queueLog(chunk);
    const p = store.running.get(chunk.pid);
    if (p && store.selectedKey.value === p.key) {
      store.lastPidByCommand.set(p.key, chunk.pid);
    }
  });

  await api.onProcExit((exit) => {
    const p = store.running.get(exit.pid);
    if (p) {
      store.lastExitByCommand.set(p.key, {
        code: exit.code,
        durationMs: exit.durationMs,
        atMs: Date.now(),
      });
      store.running.delete(exit.pid);
    }
    // 若该命令所属方案中的所有命令均已停止,从已启动方案集合移除
    if (store.launchedScenarioIds.value.size > 0) {
      const next = new Set(store.launchedScenarioIds.value);
      let changed = false;
      for (const sId of next) {
        const sc = (store.config.scenarios ?? []).find((s) => s.id === sId);
        if (!sc) {
          next.delete(sId);
          changed = true;
          continue;
        }
        const hasRunning = (sc.items ?? []).some((it) => runningOf(commandKey(it.projectId, it.commandId)) != null);
        if (!hasRunning) {
          next.delete(sId);
          changed = true;
        }
      }
      if (changed) {
        store.launchedScenarioIds.value = next;
      }
    }
    appendSysLine(
      exit.pid,
      exit.code == null
        ? `— 进程已终止(无退出码),运行 ${formatDuration(exit.durationMs)} —`
        : `— 进程已退出,退出码 ${exit.code},运行 ${formatDuration(exit.durationMs)} —`,
    );
  });

  store.loaded.value = true;
  selectFirstCommand();
}

// ---------------------------------------------------------------- 持久化

let persistTimer = null;

export function persist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const plain = JSON.parse(
      JSON.stringify({
        version: store.config.version,
        groups: store.config.groups,
        projects: store.config.projects ?? [],
        scenarios: store.config.scenarios ?? [],
        settings: store.config.settings,
      }),
    );
    api.saveConfig(plain).catch((e) => console.error("保存配置失败", e));
  }, PERSIST_DEBOUNCE_MS);
}

// ---------------------------------------------------------------- CRUD

export function addGroup(parentId, name) {
  const group = { id: genId("g"), name, collapsed: false, groups: [], projects: [] };
  if (parentId) {
    const pos = findGroupById(parentId);
    if (!pos) return addGroup(null, name);
    (pos.group.groups ??= []).push(group);
  } else {
    store.config.groups.push(group);
  }
  persist();
  return group;
}

export function updateGroup(group, name) {
  group.name = name;
  persist();
}

/** 删除分组:直属子分组与项目上移到父级(与旧版 XProj 一致,不删任何内容) */
export function removeGroup(group) {
  const pos = findGroupById(group.id);
  if (!pos) return;
  pos.list.splice(pos.index, 1, ...(group.groups ?? []), ...(group.projects ?? []));
  persist();
}

export function addProject(spec) {
  const form = spec && typeof spec === "object" ? spec : {};
  const project = {
    id: genId("p"),
    name: form.name || "新项目",
    dir: form.dir || "",
    collapsed: false,
    commands: [],
  };
  (store.config.projects ??= []).push(project);
  persist();
  return project;
}

export function updateProject(project, { name, dir }) {
  project.name = name;
  project.dir = dir;
  persist();
}

export function removeProject(project) {
  for (const cmd of project.commands ?? []) stopIfRunning(project, cmd, true);
  const list = store.config.projects ?? [];
  const idx = list.findIndex((p) => p.id === project.id);
  if (idx >= 0) list.splice(idx, 1);
  persist();
}

/** 拖拽重排项目顺序 */
export function reorderProjects(fromIndex, toIndex) {
  const list = store.config.projects ?? [];
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= list.length || toIndex >= list.length || fromIndex === toIndex) return;
  const [moved] = list.splice(fromIndex, 1);
  list.splice(toIndex, 0, moved);
  persist();
}

/** 拖拽重排命令顺序 */
export function reorderCommands(project, fromIndex, toIndex) {
  const list = project.commands ?? [];
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= list.length || toIndex >= list.length || fromIndex === toIndex) return;
  const [moved] = list.splice(fromIndex, 1);
  list.splice(toIndex, 0, moved);
  persist();
}

/** 判断是否为一次性任务/构建脚本 */
export function isTaskCommand(command) {
  if (!command) return false;
  if (command.kind === "task") return true;
  if (command.kind === "service") return false;
  const text = `${command.name || ""} ${command.cmd || ""}`.toLowerCase();
  return /build|package|clean|shutdown|deploy|copy|打包|编译|关机|发布/i.test(text);
}

/** 智能清洗命令行显示,去除冗余 JVM 内存参数,提取核心目标 */
export function cleanCmdSnippet(cmd) {
  if (!cmd) return "";
  const trimmed = cmd.trim();

  // 1. Java jar: 提取真实 jar 包名称
  const jarMatch = trimmed.match(/-jar\s+["']?([^"'\s]+\.jar)["']?/i);
  if (jarMatch) {
    const jarName = jarMatch[1].split(/[\\/]/).pop();
    return `jar: ${jarName}`;
  }

  // 2. Maven: 提取 package 模块或 goal
  if (/^mvn\b/i.test(trimmed)) {
    const plMatch = trimmed.match(/-pl\s+["']?([^"'\s]+)["']?/i);
    if (plMatch) {
      const moduleName = plMatch[1].split(/[\\/]/).pop();
      return `mvn: ${moduleName}`;
    }
    const goalMatch = trimmed.match(/^mvn\s+([a-zA-Z:-]+)/i);
    if (goalMatch) return `mvn ${goalMatch[1]}`;
  }

  // 3. Dotnet: 提取 dll 名称
  const dotnetMatch = trimmed.match(/^dotnet\s+["']?([^"'\s]+\.dll)["']?/i);
  if (dotnetMatch) {
    const dllName = dotnetMatch[1].split(/[\\/]/).pop();
    return `dotnet: ${dllName}`;
  }

  // 4. npm/pnpm/yarn/bun run
  const pkgRunMatch = trimmed.match(/^(pnpm|npm|yarn|bun)(\s+run)?\s+([a-zA-Z0-9_:.-]+)/i);
  if (pkgRunMatch) {
    return `${pkgRunMatch[1]} ${pkgRunMatch[3]}`;
  }

  // 5. 去除冗余参数并保留核心
  let s = trimmed;
  if (/^java\b/i.test(s)) {
    s = s.replace(/-Xm[sx]\S+/gi, "").replace(/-D\S+/gi, "").replace(/\s+/g, " ").trim();
  }
  return s;
}

export function addCommand(project, spec) {
  const command = {
    id: genId("c"),
    name: spec.name,
    cmd: spec.cmd,
    shell: spec.shell || "cmd",
    cwd: spec.cwd,
    env: spec.env,
    kind: spec.kind || (isTaskCommand(spec) ? "task" : "service"),
  };
  project.commands.push(command);
  persist();
  return command;
}

export function updateCommand(command, spec) {
  command.name = spec.name;
  command.cmd = spec.cmd;
  command.shell = spec.shell || "cmd";
  command.cwd = spec.cwd;
  command.env = spec.env;
  if (spec.kind) command.kind = spec.kind;
  persist();
}

export function removeCommand(project, command) {
  stopIfRunning(project, command, true);
  const key = commandKey(project.id, command.id);
  if (store.selectedKey.value === key) store.selectedKey.value = null;
  project.commands.splice(project.commands.indexOf(command), 1);
  // 同步清理运行方案里引用了该命令的条目
  const cid = command.id;
  const pid2 = project.id;
  for (const scenario of store.config.scenarios ?? []) {
    const before = scenario.items.length;
    scenario.items = scenario.items.filter((it) => !(it.projectId === pid2 && it.commandId === cid));
    if (scenario.items.length !== before) persist();
  }
  persist();
}

function genId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------- 进程操作

export async function startCommand(project, command) {
  const key = commandKey(project.id, command.id);
  if (runningOf(key)) return;
  // 同一命令重开新会话时,丢弃上一会话的日志缓冲,避免内存随重启次数增长
  const prevPid = store.lastPidByCommand.get(key);
  if (prevPid != null && !store.running.has(prevPid)) {
    store.logs.delete(prevPid);
    pendingByPid.delete(prevPid);
  }
  const req = {
    projectId: project.id,
    commandId: command.id,
    commandName: command.name,
    cmd: command.cmd,
    shell: command.shell || "cmd",
    cwd: command.cwd || project.dir || "",
    env: command.env ?? {},
  };
  const info = await api.startProcess(req).catch((e) => {
    notify(`启动「${command.name}」失败:${e}`);
    return null;
  });
  if (!info) return;
  const entry = { ...info, projectId: project.id, commandId: command.id, commandName: command.name, key };
  store.running.set(info.pid, entry);
  store.lastPidByCommand.set(key, info.pid);
  store.selectedKey.value = key;
  appendSysLine(info.pid, `— 已启动:pid ${info.pid} —`);
}

export async function stopPid(pid) {
  if (store.running.has(pid)) await api.stopProcess(pid);
}

export function stopIfRunning(project, command, awaitStop = false) {
  const p = runningOf(commandKey(project.id, command.id));
  if (!p) return Promise.resolve(false);
  const promise = api.stopProcess(p.pid);
  if (awaitStop) {
    return promise.then(() => waitForExit(p.pid)).catch(() => {});
  }
  return promise;
}

function waitForExit(pid, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (!store.running.has(pid) || Date.now() - started > timeoutMs) {
        clearInterval(timer);
        resolve();
      }
    }, 120);
  });
}

export async function restartCommand(project, command) {
  await stopIfRunning(project, command, true);
  await startCommand(project, command);
}

/** 收集分组下所有项目的所有命令 */
export function allCommandsOfGroup(group) {
  const result = [];
  const walk = (g) => {
    for (const p of g.projects ?? []) {
      for (const c of p.commands ?? []) {
        result.push({ project: p, command: c });
      }
    }
    for (const sub of g.groups ?? []) {
      walk(sub);
    }
  };
  walk(group);
  return result;
}

/** 批量启动分组下的全部命令 */
export async function startGroup(group) {
  const items = allCommandsOfGroup(group);
  let started = 0;
  for (const { project, command } of items) {
    const key = commandKey(project.id, command.id);
    if (runningOf(key)) continue;
    if (isTaskCommand(command)) continue; // 批量默认跳过一次性构建任务
    if (started > 0) {
      await new Promise((r) => setTimeout(r, 200));
    }
    await startCommand(project, command);
    started++;
  }
  return started;
}

/** 批量停止分组下所有正在运行的命令 */
export async function stopGroup(group) {
  const items = allCommandsOfGroup(group);
  for (const { project, command } of items) {
    await stopIfRunning(project, command);
  }
}

/** 批量启动项目下的命令 */
export async function startProject(project) {
  let started = 0;
  for (const cmd of project.commands ?? []) {
    const key = commandKey(project.id, cmd.id);
    if (runningOf(key)) continue;
    if (isTaskCommand(cmd)) continue; // 默认跳过任务/构建
    if (started > 0) await new Promise((r) => setTimeout(r, 200));
    await startCommand(project, cmd);
    started++;
  }
  // 如果全是任务，则启动第一个
  if (started === 0 && (project.commands ?? []).length > 0) {
    for (const cmd of project.commands) {
      const key = commandKey(project.id, cmd.id);
      if (runningOf(key)) continue;
      if (started > 0) await new Promise((r) => setTimeout(r, 200));
      await startCommand(project, cmd);
      started++;
      break;
    }
  }
  return started;
}

/** 批量停止项目下所有运行中命令 */
export async function stopProject(project) {
  for (const cmd of project.commands ?? []) {
    await stopIfRunning(project, cmd);
  }
}

/** 克隆/复制一条命令 */
export function duplicateCommand(project, command) {
  const spec = {
    name: `${command.name} (副本)`,
    cmd: command.cmd,
    shell: command.shell || "cmd",
    cwd: command.cwd || "",
    env: { ...(command.env ?? {}) },
    kind: command.kind,
  };
  const newCmd = addCommand(project, spec);
  notify(`已克隆命令「${newCmd.name}」`);
  return newCmd;
}

/** 全部展开 */
export function expandAll() {
  const walk = (groups) => {
    for (const g of groups) {
      g.collapsed = false;
      for (const p of g.projects ?? []) p.collapsed = false;
      walk(g.groups ?? []);
    }
  };
  walk(store.config.groups ?? []);
  for (const p of store.config.projects ?? []) p.collapsed = false;
  persist();
}

/** 全部折叠 */
export function collapseAll() {
  const walk = (groups) => {
    for (const g of groups) {
      g.collapsed = true;
      for (const p of g.projects ?? []) p.collapsed = true;
      walk(g.groups ?? []);
    }
  };
  walk(store.config.groups ?? []);
  for (const p of store.config.projects ?? []) p.collapsed = true;
  persist();
}

/** 复制文本到剪贴板 */
export async function copyToClipboard(text, successMsg = "已复制到剪贴板") {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    notify(successMsg);
  } catch (err) {
    notify(`复制失败: ${err}`);
  }
}

/** 停止所有运行中的进程 */
export async function stopAll() {
  store.launchedScenarioIds.value = new Set();
  for (const p of store.running.values()) {
    await api.stopProcess(p.pid).catch(() => {});
  }
}

/** 自动选中第一个有效命令 */
export function selectFirstCommand() {
  if (store.selectedKey.value) return;
  for (const p of store.config.projects ?? []) {
    if (p.commands?.length > 0) {
      store.selectedKey.value = commandKey(p.id, p.commands[0].id);
      return;
    }
  }
}

// ---------------------------------------------------------------- 设置

export function updateSettings(patch) {
  Object.assign(store.config.settings, patch);
  applySettings(store.config.settings);
  persist();
}

// ---------------------------------------------------------------- 运行方案

/** 按 id 在配置树中定位项目与命令;已删除的返回 null */
export function locateById(projectId, commandId) {
  const project = (store.config.projects ?? []).find((p) => p.id === projectId);
  if (!project) return null;
  const command = (project.commands ?? []).find((c) => c.id === commandId);
  if (!command) return null;
  return { project, command };
}

export function addScenario(name, items) {
  const scenario = { id: genId("s"), name, items };
  (store.config.scenarios ??= []).push(scenario);
  persist();
  return scenario;
}

export function updateScenario(scenario, name, items) {
  scenario.name = name;
  scenario.items = items;
  persist();
}

export function removeScenario(scenario) {
  const list = store.config.scenarios ?? [];
  const idx = list.indexOf(scenario);
  if (idx >= 0) list.splice(idx, 1);
  if (store.launchedScenarioIds.value.has(scenario.id)) {
    const next = new Set(store.launchedScenarioIds.value);
    next.delete(scenario.id);
    store.launchedScenarioIds.value = next;
  }
  persist();
}

/** 按方案批量启动;支持单项独立延时(delaySeconds),默认间隔 400ms 避免抢占目录/端口 */
export async function runScenario(scenario) {
  const next = new Set(store.launchedScenarioIds.value);
  next.add(scenario.id);
  store.launchedScenarioIds.value = next;

  let started = 0;
  for (const item of scenario.items ?? []) {
    const loc = locateById(item.projectId, item.commandId);
    if (!loc) continue;
    if (runningOf(commandKey(loc.project.id, loc.command.id))) continue;
    const delay = Number(item.delaySeconds) || 0;
    if (delay > 0) {
      notify(`方案「${scenario.name}」: 等待 ${delay} 秒后启动「${loc.command.name}」`);
      await new Promise((r) => setTimeout(r, delay * 1000));
    } else if (started > 0) {
      await new Promise((r) => setTimeout(r, 400));
    }
    await startCommand(loc.project, loc.command);
    started += 1;
  }
  return started;
}

/** 停止方案包含的所有正在运行的命令 */
export async function stopScenario(scenario) {
  if (!scenario) return;
  const next = new Set(store.launchedScenarioIds.value);
  next.delete(scenario.id);
  store.launchedScenarioIds.value = next;

  for (const item of scenario.items ?? []) {
    const key = commandKey(item.projectId, item.commandId);
    const p = runningOf(key);
    if (p) {
      await api.stopProcess(p.pid).catch(() => {});
    }
  }
}

/** 判断方案是否是通过方案启动且当前仍有命令在运行 */
export function isScenarioRunning(scenario) {
  if (!scenario?.id || !store.launchedScenarioIds.value.has(scenario.id)) return false;
  return (scenario.items ?? []).some((it) => runningOf(commandKey(it.projectId, it.commandId)) != null);
}

// ---------------------------------------------------------------- 导入 / 导出

export async function exportConfigToFile() {
  const path = await api.pickSavePath();
  if (!path) return false;
  const plain = JSON.parse(
    JSON.stringify({
      version: store.config.version,
      groups: store.config.groups,
      projects: store.config.projects ?? [],
      scenarios: store.config.scenarios ?? [],
      settings: store.config.settings,
    }),
  );
  await api.exportConfig(path, plain);
  return true;
}

export async function importConfigFromFile() {
  const path = await api.pickOpenPath();
  if (!path) return false;
  const imported = await api.importConfig(path);
  const ok = await confirmAction(
    `导入将覆盖当前的分组、运行方案与设置,继续?\n来源:${path}`,
    { title: "导入配置", danger: true },
  );
  if (!ok) return false;
  store.config.version = imported.version ?? 1;
  store.config.groups = imported.groups ?? [];
  store.config.projects = imported.projects ?? [];
  store.config.scenarios = imported.scenarios ?? [];
  store.config.settings = { ...DEFAULT_SETTINGS, ...(imported.settings ?? {}) };
  applySettings(store.config.settings);
  store.selectedKey.value = null;
  persist();
  return true;
}

// ---------------------------------------------------------------- 确认框 / 轻提示

// Tauri 下 window.confirm/alert 不可靠,一律走应用内自绘对话框。
export const confirmState = ref(null); // { title, message, danger, resolve }

export function confirmAction(message, { title = "确认操作", danger = false } = {}) {
  return new Promise((resolve) => {
    confirmState.value = { title, message, danger, resolve };
  });
}

export function settleConfirm(result) {
  confirmState.value?.resolve(result);
  confirmState.value = null;
}

export const toasts = ref([]);
let toastSeq = 0;

/** 底部轻提示,3.2s 自动消失 */
export function notify(text) {
  const id = ++toastSeq;
  toasts.value.push({ id, text });
  setTimeout(() => {
    const i = toasts.value.findIndex((t) => t.id === id);
    if (i >= 0) toasts.value.splice(i, 1);
  }, 3200);
}

// ---------------------------------------------------------------- 确认框 / 轻提示 结束

// ---------------------------------------------------------------- 格式化

export function formatDuration(ms) {
  if (ms == null || Number.isNaN(ms)) return "";
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatTime(tsMs) {
  const d = new Date(tsMs);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}
