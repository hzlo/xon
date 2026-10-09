<script setup>
// 右侧终端面板:多标签(Tabs)+ 高密度日志查看器 + 底部轻量状态栏
import {
  Eraser,
  Play,
  Pause,
  RotateCw,
  Search,
  Square,
  Terminal,
  X,
} from "lucide-vue-next";
import { computed, nextTick, onMounted, ref, watch } from "vue";
import {
  clearLog,
  commandKey,
  formatDuration,
  formatTime,
  locateCommand,
  restartCommand,
  runningOf,
  selectFirstCommand,
  startCommand,
  stopPid,
  store,
} from "../stores/app.js";

onMounted(() => {
  if (!store.selectedKey.value) {
    selectFirstCommand();
  }
});

const sel = computed(() => locateCommand(store.selectedKey.value));
const selKey = computed(() =>
  sel.value ? commandKey(sel.value.project.id, sel.value.command.id) : null,
);
const proc = computed(() => (selKey.value ? runningOf(selKey.value) : null));
const lines = computed(() => store.selectedLines.value);

// ---- 标签页 (Tabs) ----
const openTabs = ref([]);

watch(
  () => store.selectedKey.value,
  (key) => {
    if (!key) return;
    const found = locateCommand(key);
    if (!found) return;
    const exists = openTabs.value.find((t) => t.key === key);
    if (!exists) {
      openTabs.value.push({
        key,
        name: found.command.name,
        cmd: found.command.cmd,
      });
    }
  },
  { immediate: true },
);

function selectTab(key) {
  store.selectedKey.value = key;
}

function closeTab(key, e) {
  e.stopPropagation();
  const idx = openTabs.value.findIndex((t) => t.key === key);
  if (idx >= 0) {
    openTabs.value.splice(idx, 1);
    if (store.selectedKey.value === key) {
      if (openTabs.value.length > 0) {
        store.selectedKey.value = openTabs.value[Math.max(0, idx - 1)].key;
      } else {
        selectFirstCommand();
      }
    }
  }
}

function tabStatus(key) {
  if (runningOf(key)) return "running";
  const exit = store.lastExitByCommand.get(key);
  if (exit?.code != null && exit.code !== 0) return "error";
  return "stopped";
}

function portOf(cmd) {
  if (!cmd) return "";
  const m = cmd.match(/(?:--port[=\s]|:|-p\s+|PORT=|port=)(\d{2,5})/i);
  if (m) return `:${m[1]}`;
  return "";
}

// ---- 搜索与筛选 ----
const query = ref("");
const streamFilter = ref("all"); // all | out | err

const filteredLines = computed(() => {
  let list = lines.value ?? [];
  if (streamFilter.value !== "all") {
    list = list.filter((l) => l.stream === streamFilter.value);
  }
  const q = query.value.trim().toLowerCase();
  if (q) {
    list = list.filter((l) => l.text.toLowerCase().includes(q));
  }
  return list;
});

const matchInfo = computed(() => {
  const q = query.value.trim();
  if (!q && streamFilter.value === "all") return "";
  return `${filteredLines.value.length}/${(lines.value ?? []).length} 行`;
});

function clearFilters() {
  query.value = "";
  streamFilter.value = "all";
}

const status = computed(() => {
  if (proc.value) return { state: "running", label: "运行中" };
  const exit = selKey.value ? store.lastExitByCommand.get(selKey.value) : null;
  if (exit?.code != null && exit.code !== 0) return { state: "error", label: `退出 ${exit.code}` };
  return { state: "stopped", label: "已停止" };
});

const pid = computed(() => proc.value?.pid ?? (selKey.value ? store.lastPidByCommand.get(selKey.value) ?? null : null));

const uptime = computed(() => {
  if (proc.value) return formatDuration(store.now.value - proc.value.startedAtMs);
  const exit = selKey.value ? store.lastExitByCommand.get(selKey.value) : null;
  return exit ? formatDuration(exit.durationMs) : "";
});

// ---- 自动滚动控制 ----
const bodyRef = ref(null);
const manualPaused = ref(false);
const scrolledUp = ref(false);
const hovering = ref(false);
const paused = computed(() => manualPaused.value || scrolledUp.value || hovering.value);

function onScroll() {
  const el = bodyRef.value;
  if (!el) return;
  const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
  scrolledUp.value = dist > 48;
}

function jumpToBottom() {
  const el = bodyRef.value;
  if (el) el.scrollTop = el.scrollHeight;
}

watch(
  () => [store.selectedKey.value, filteredLines.value?.length ?? 0],
  async () => {
    if (paused.value) return;
    await nextTick();
    jumpToBottom();
  },
);

async function resumeAutoScroll() {
  manualPaused.value = false;
  scrolledUp.value = false;
  await nextTick();
  jumpToBottom();
}

function streamClass(stream) {
  switch (stream) {
    case "out":
      return "log-info";
    case "err":
      return "log-warn";
    case "sys":
      return "log-sys";
    default:
      return "log-debug";
  }
}

function onStop() {
  if (proc.value) stopPid(proc.value.pid);
}
function onStart() {
  if (sel.value) startCommand(sel.value.project, sel.value.command);
}
function onRestart() {
  if (sel.value) restartCommand(sel.value.project, sel.value.command);
}
function onClear() {
  if (pid.value != null) clearLog(pid.value);
}
</script>

<template>
  <section class="logpane" aria-label="日志面板">
    <!-- 顶部多标签栏 (Tabs Bar) -->
    <div class="tabs-header">
      <div class="tabs-list">
        <div
          v-for="tab in openTabs"
          :key="tab.key"
          class="tab-item"
          :class="{ active: tab.key === store.selectedKey.value }"
          @click="selectTab(tab.key)"
        >
          <span class="tab-dot" :class="tabStatus(tab.key)"></span>
          <span class="tab-name">{{ tab.name }}</span>
          <span v-if="portOf(tab.cmd)" class="tab-port">{{ portOf(tab.cmd) }}</span>
          <button
            v-if="openTabs.length > 1"
            class="tab-close"
            title="关闭标签页"
            @click="closeTab(tab.key, $event)"
          >
            <X />
          </button>
        </div>
      </div>

      <!-- 右侧快速控制项 -->
      <div v-if="sel" class="tab-controls">
        <div class="log-search-wrap">
          <Search class="search-mini-icon" />
          <input
            v-model="query"
            type="search"
            autocomplete="off"
            spellcheck="false"
            placeholder="过滤日志…"
            class="log-search-mini"
          />
          <button v-if="query" class="search-mini-clear" @click="query = ''">×</button>
        </div>

        <select v-model="streamFilter" class="select-mini" aria-label="按输出流筛选">
          <option value="all">全部</option>
          <option value="out">stdout</option>
          <option value="err">stderr</option>
        </select>

        <span class="ctrl-sep"></span>

        <button
          class="btn-ghost icon-btn"
          :title="proc ? '重启' : '启动'"
          @click="proc ? onRestart() : onStart()"
        >
          <RotateCw v-if="proc" />
          <Play v-else />
        </button>

        <button
          v-if="proc"
          class="btn-ghost icon-btn is-danger"
          title="停止"
          @click="onStop"
        >
          <Square />
        </button>

        <button class="btn-ghost icon-btn" title="清空日志" @click="onClear">
          <Eraser />
        </button>

        <button
          class="btn-ghost icon-btn"
          :title="paused ? '恢复自动滚动' : '暂停自动滚动'"
          :class="{ 'is-accent': !paused }"
          @click="paused ? resumeAutoScroll() : (manualPaused = true)"
        >
          <Pause v-if="!paused" />
          <Play v-else />
        </button>
      </div>
    </div>

    <!-- 日志流主体 -->
    <div class="log-body">
      <div
        v-if="sel"
        ref="bodyRef"
        class="log-viewer"
        @scroll="onScroll"
        @mouseenter="hovering = true"
        @mouseleave="hovering = false"
      >
        <div v-for="line in filteredLines" :key="line.id" v-memo="[line.id]" class="log-line">
          <span class="log-ts">{{ formatTime(line.ts) }}</span>
          <span :class="streamClass(line.stream)">{{ line.text }}</span>
        </div>

        <div v-if="!lines || lines.length === 0" class="empty-state">
          <Terminal />
          <p>暂无输出</p>
          <p class="hint">启动后, stdout / stderr 将逐行流式输出到这里</p>
        </div>
        <div v-else-if="filteredLines.length === 0" class="empty-state">
          <Search />
          <p>没有匹配的日志行</p>
          <p class="hint">调整搜索关键词或输出流筛选</p>
        </div>
      </div>

      <div v-else class="empty-state">
        <Terminal />
        <p>未选择进程</p>
        <p class="hint">从左侧点击一条命令查看实时终端日志</p>
      </div>

      <div v-if="sel && paused && lines && lines.length > 0" class="resume-row">
        <button class="btn-secondary resume-chip" @click="resumeAutoScroll">
          自动滚动已暂停 — 点击恢复
        </button>
      </div>
    </div>

    <!-- 底部微型状态栏 (Mini Statusbar) -->
    <footer v-if="sel" class="log-footer">
      <div class="footer-left">
        <span class="footer-dot" :class="status.state"></span>
        <span class="footer-item name-item">{{ sel.command.name }}</span>
        <span v-if="portOf(sel.command.cmd)" class="footer-item port-item">{{ portOf(sel.command.cmd) }}</span>
        <span class="footer-sep">·</span>
        <span class="footer-item">PID {{ pid ?? "—" }}</span>
        <span class="footer-sep">·</span>
        <span class="footer-item">{{ uptime ? `运行 ${uptime}` : status.label }}</span>
      </div>

      <div class="footer-right">
        <span v-if="matchInfo" class="footer-item match-tag">{{ matchInfo }}</span>
        <span class="footer-item">缓冲区 {{ lines?.length ?? 0 }} 行</span>
        <span class="footer-sep">·</span>
        <span class="footer-item" :class="{ 'text-accent': !paused }">{{ paused ? '滚屏暂停' : '实时滚屏' }}</span>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.logpane {
  display: flex;
  flex-direction: column;
  flex: 1;
  height: 100%;
  min-width: 0;
  background: var(--color-background);
}

/* 顶部标签栏 */
.tabs-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 35px;
  background: var(--color-card);
  border-bottom: 1px solid var(--color-divider);
  padding: 0 8px;
  box-sizing: border-box;
  flex: none;
}

.tabs-list {
  display: flex;
  align-items: stretch;
  height: 100%;
  gap: 2px;
  overflow-x: auto;
}

.tab-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  font-size: 0.8462rem;
  font-weight: 500;
  color: var(--color-muted-foreground);
  cursor: pointer;
  border-top: 2px solid transparent;
  transition: all var(--dur-fast) var(--ease);
}
.tab-item:hover {
  color: var(--color-foreground);
  background: var(--overlay-hover);
}
.tab-item.active {
  color: var(--color-foreground);
  background: var(--color-background);
  border-top-color: var(--color-accent);
}

.tab-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-border);
  flex: none;
}
.tab-dot.running {
  background: var(--color-success, #A3BE8C);
  box-shadow: 0 0 5px rgba(163, 190, 140, 0.6);
}
.tab-dot.error {
  background: var(--color-destructive, #BF616A);
}

.tab-name {
  white-space: nowrap;
}

.tab-port {
  font-family: var(--font-mono);
  font-size: 0.77rem;
  color: var(--color-accent);
  opacity: 0.85;
}

.tab-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border: none;
  background: transparent;
  color: var(--color-muted-foreground);
  border-radius: var(--radius-sm);
  cursor: pointer;
  padding: 0;
  margin-left: 2px;
  opacity: 0.6;
}
.tab-close svg {
  width: 10px;
  height: 10px;
}
.tab-close:hover {
  background: var(--overlay-hover);
  opacity: 1;
  color: var(--color-foreground);
}

.tab-controls {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.log-search-wrap {
  display: flex;
  align-items: center;
  background: var(--input-bg);
  border: 1px solid var(--input-border);
  border-radius: var(--radius-sm);
  height: 22px;
  padding: 0 6px;
}
.search-mini-icon {
  width: 11px;
  height: 11px;
  color: var(--color-muted-foreground);
  opacity: 0.6;
  margin-right: 4px;
}
.log-search-mini {
  border: none;
  background: transparent;
  color: var(--color-foreground);
  font-family: var(--font-mono);
  font-size: 0.77rem;
  outline: none;
  width: 120px;
}
.search-mini-clear {
  border: none;
  background: transparent;
  color: var(--color-muted-foreground);
  font-size: 12px;
  cursor: pointer;
  padding: 0;
}

.select-mini {
  background: var(--input-bg);
  color: var(--color-foreground);
  border: 1px solid var(--input-border);
  border-radius: var(--radius-sm);
  height: 22px;
  font-size: 0.77rem;
  padding: 0 4px;
  outline: none;
}

.ctrl-sep {
  width: 1px;
  height: 14px;
  background: var(--color-border);
  margin: 0 2px;
}

.log-body {
  position: relative;
  flex: 1;
  min-height: 0;
}
.log-viewer {
  height: 100%;
}

.resume-row {
  position: absolute;
  left: 0;
  right: 0;
  bottom: var(--space-xl);
  display: flex;
  justify-content: center;
  pointer-events: none;
}
.resume-chip {
  pointer-events: auto;
  box-shadow: var(--shadow-md);
  font-size: 0.8462rem;
}

/* 底部状态脚标 */
.log-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 24px;
  background: var(--color-card);
  border-top: 1px solid var(--color-divider);
  padding: 0 10px;
  box-sizing: border-box;
  font: 400 0.77rem/1 var(--font-mono);
  color: var(--color-muted-foreground);
  flex: none;
  user-select: none;
}

.footer-left,
.footer-right {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.footer-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-border);
}
.footer-dot.running {
  background: var(--color-success, #A3BE8C);
  box-shadow: 0 0 5px rgba(163, 190, 140, 0.6);
}
.footer-dot.error {
  background: var(--color-destructive, #BF616A);
}

.name-item {
  color: var(--color-foreground);
  font-weight: 500;
}

.port-item {
  color: var(--color-accent);
}

.footer-sep {
  opacity: 0.4;
}

.text-accent {
  color: var(--color-accent);
}
</style>
