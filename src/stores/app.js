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
  accent: "#22C55E",
  uiFont: "",
  logFont: "",
  logFontSize: 12,
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
  const root = document.documentElement;
  root.dataset.theme = s.theme === "light" ? "light" : "dark";

  const base = hexToRgb(s.accent) ?? hexToRgb(DEFAULT_SETTINGS.accent);
  // 徽章/状态文字:暗色下提亮保证对比度,亮色下压暗
  const textColor = s.theme === "light" ? shadeRgb(base, -0.3) : shadeRgb(base, 0.32);
  root.style.setProperty("--color-accent", rgbCss(base));
  root.style.setProperty("--color-accent-hover", rgbCss(shadeRgb(base, -0.12)));
  root.style.setProperty("--color-accent-active", rgbCss(shadeRgb(base, -0.24)));
  root.style.setProperty("--color-accent-text", rgbCss(textColor));
  root.style.setProperty("--color-accent-soft-bg", rgbaCss(base, 0.14));
  root.style.setProperty("--color-accent-soft-border", rgbaCss(base, 0.35));
  root.style.setProperty("--color-accent-glow", rgbaCss(base, 0.8));
  root.style.setProperty("--color-accent-glow-soft", rgbaCss(base, 0.35));

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
  root.style.setProperty("--log-font-size", `${Math.max(10, Math.min(18, Number(s.logFontSize) || 12))}px`);
}

export const store = {
  loaded: ref(false),
  /** @type {import("vue").Reactive<import("api.js").AppConfig>} */
  config: reactive({ version: 1, groups: [], projects: [], scenarios: [], settings: { ...DEFAULT_SETTINGS } }),
  /** pid → { pid, projectId, commandId, commandName, key, startedAtMs } */
  running: reactive(new Map()),
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

/** 按 key 在配置树中定位 { group, project, command };找不到返回 null(分组树可无限嵌套) */
export function locateCommand(key) {
  if (!key) return null;
  let found = null;
  const walk = (groups) => {
    for (const group of groups) {
      for (const project of group.projects ?? []) {
        for (const command of project.commands) {
          if (command.id && commandKey(project.id, command.id) === key) {
            found = { group, project, command };
            return true;
          }
        }
      }
      if (walk(group.groups ?? [])) return true;
    }
    return false;
  };
  walk(store.config.groups);
  return found;
}

/** 深度优先找分组在父列表中的位置 */
function findGroupPosition(groups, groupId) {
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    if (group.id === groupId) return { list: groups, index: i, group };
    const deeper = findGroupPosition(group.groups ?? [], groupId);
    if (deeper) return deeper;
  }
  return null;
}

export function findGroupById(groupId) {
  return groupId ? findGroupPosition(store.config.groups, groupId) : null;
}

/** 深度优先找项目在父列表中的位置 */
function findProjectPosition(groups, projectId) {
  for (const group of groups) {
    const list = group.projects ?? [];
    const index = list.findIndex((p) => p.id === projectId);
    if (index >= 0) return { list, index, project: list[index] };
    const deeper = findProjectPosition(group.groups ?? [], projectId);
    if (deeper) return deeper;
  }
  return null;
}

/** 判断 group(子树)里是否包含 groupId 的分组 */
function subtreeHasGroup(group, groupId) {
  if (group.id === groupId) return true;
  return (group.groups ?? []).some((child) => subtreeHasGroup(child, groupId));
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
  store.config.groups = config.groups ?? [];
  store.config.projects = config.projects ?? [];
  store.config.scenarios = config.scenarios ?? [];
  store.config.settings = { ...DEFAULT_SETTINGS, ...(config.settings ?? {}) };
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
    appendSysLine(
      exit.pid,
      exit.code == null
        ? `— 进程已终止(无退出码),运行 ${formatDuration(exit.durationMs)} —`
        : `— 进程已退出,退出码 ${exit.code},运行 ${formatDuration(exit.durationMs)} —`,
    );
  });

  store.loaded.value = true;
}

// ---------------------------------------------------------------- 持久化

let persistTimer = null;

function persist() {
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

export function addProject(group, { name, dir }) {
  const project = { id: genId("p"), name, dir, commands: [] };
  if (group) (group.projects ??= []).push(project);
  else (store.config.projects ??= []).push(project);
  persist();
  return project;
}

export function updateProject(project, { name, dir }) {
  project.name = name;
  project.dir = dir;
  persist();
}

export function removeProject(project) {
  for (const cmd of project.commands) stopIfRunning(project, cmd, true);
  const pos = findProjectPosition(store.config.groups, project.id)
    ?? findProjectPosition([{ id: "__root__", projects: store.config.projects ?? [] }], project.id);
  if (pos) pos.list.splice(pos.index, 1);
  persist();
}

export function addCommand(project, spec) {
  const command = { id: genId("c"), name: spec.name, cmd: spec.cmd, cwd: spec.cwd, env: spec.env };
  project.commands.push(command);
  persist();
  return command;
}

export function updateCommand(command, spec) {
  command.name = spec.name;
  command.cmd = spec.cmd;
  command.cwd = spec.cwd;
  command.env = spec.env;
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

/**
 * 拖拽移动节点:分组或项目移动到目标分组(或根级)。
 * 防御:分组不能移进自己/自己的后代;同层移动视为无变化。
 */
export function moveNode(type, id, targetGroupId) {
  let node = null;
  let fromList = null;
  if (type === "group") {
    const pos = findGroupById(id);
    if (!pos) return false;
    node = pos.group;
    fromList = pos.list;
    if (targetGroupId && (id === targetGroupId || subtreeHasGroup(node, targetGroupId))) {
      return false; // 不能移进自己或自己的后代
    }
  } else {
    const pos = findProjectPosition(store.config.groups, id)
      ?? findProjectPosition([{ id: "__root__", projects: store.config.projects ?? [] }], id);
    if (!pos) return false;
    node = pos.project;
    fromList = pos.list;
  }

  let toList;
  if (targetGroupId) {
    const target = findGroupById(targetGroupId);
    if (!target) return false;
    toList = type === "group" ? (target.group.groups ??= []) : (target.group.projects ??= []);
  } else {
    toList = type === "group" ? store.config.groups : (store.config.projects ??= []);
  }
  if (toList === fromList) return false;

  fromList.splice(fromList.indexOf(node), 1);
  toList.push(node);
  persist();
  return true;
}

// ---------------------------------------------------------------- 设置

export function updateSettings(patch) {
  Object.assign(store.config.settings, patch);
  applySettings(store.config.settings);
  persist();
}

// ---------------------------------------------------------------- 运行方案

/** 按 id 在配置树中定位项目与命令(含根级项目);已删除的返回 null */
export function locateById(projectId, commandId) {
  const found = locateProjectAny(projectId);
  if (!found) return null;
  const command = found.project.commands.find((c) => c.id === commandId);
  if (!command) return null;
  return { project: found.project, command };
}

function locateProjectAny(projectId) {
  const inRoot = (store.config.projects ?? []).find((p) => p.id === projectId);
  if (inRoot) return { project: inRoot };
  const pos = findProjectPosition(store.config.groups, projectId);
  return pos ? { project: pos.project } : null;
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
  list.splice(list.indexOf(scenario), 1);
  persist();
}

/** 按方案批量启动;每条间隔 400ms,避免同时抢占工作目录/端口 */
export async function runScenario(scenario) {
  let started = 0;
  for (const item of scenario.items ?? []) {
    const loc = locateById(item.projectId, item.commandId);
    if (!loc) continue;
    if (runningOf(commandKey(loc.project.id, loc.command.id))) continue;
    if (started > 0) await new Promise((r) => setTimeout(r, 400));
    await startCommand(loc.project, loc.command);
    started += 1;
  }
  return started;
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
