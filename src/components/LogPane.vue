<script setup>
// 右侧终端面板:实时日志查看器。
// 自动滚动按 MASTER.md 要求:用户向上滚动或悬停即暂停,提供显式恢复控件;
// 滚动一律瞬时跳转(尊重 prefers-reduced-motion,不做平滑滚动)。
import { Eraser, Play, Pause, RotateCw, Search, Square, Terminal } from "lucide-vue-next";
import { computed, nextTick, ref, watch } from "vue";
import {
  clearLog,
  commandKey,
  formatDuration,
  formatTime,
  locateCommand,
  restartCommand,
  runningOf,
  startCommand,
  stopPid,
  store,
} from "../stores/app.js";
import StatusBadge from "./StatusBadge.vue";

const sel = computed(() => locateCommand(store.selectedKey.value));
const selKey = computed(() =>
  sel.value ? commandKey(sel.value.project.id, sel.value.command.id) : null,
);
const proc = computed(() => (selKey.value ? runningOf(selKey.value) : null));
const lines = computed(() => store.selectedLines.value);

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
    <header v-if="sel" class="log-header">
      <div class="log-title">
        <Terminal class="row-icon" />
        <span class="log-name">{{ sel.command.name }}</span>
        <span class="log-proj">{{ sel.project.name }}</span>
      </div>
      <StatusBadge :state="status.state" :label="status.label" />
      <span class="meta">pid {{ pid ?? "—" }} · {{ uptime || "--:--" }}</span>
      <span class="spacer" />
      <button
        class="btn-ghost icon-btn"
        :aria-label="paused ? '恢复自动滚动' : '暂停自动滚动'"
        :title="paused ? '恢复自动滚动' : '暂停自动滚动'"
        @click="paused ? resumeAutoScroll() : (manualPaused = true)"
      >
        <Pause v-if="!manualPaused" />
        <Play v-else />
      </button>
      <button class="btn-ghost icon-btn" aria-label="清空日志" title="清空日志" @click="onClear">
        <Eraser />
      </button>
      <button v-if="proc" class="btn-ghost icon-btn" aria-label="重启命令" title="重启" @click="onRestart">
        <RotateCw />
      </button>
      <button v-if="proc" class="btn-danger" @click="onStop"><Square />停止</button>
      <button v-else class="btn-primary" @click="onStart"><Play />启动</button>
    </header>

    <div v-if="sel" class="log-filter-row">
      <input
        v-model="query"
        class="input log-search"
        type="search"
        placeholder="搜索日志…"
        aria-label="搜索日志"
      />
      <select v-model="streamFilter" class="select log-stream-filter" aria-label="按输出流筛选">
        <option value="all">全部输出</option>
        <option value="out">仅 stdout</option>
        <option value="err">仅 stderr</option>
      </select>
      <span v-if="matchInfo" class="match-info">{{ matchInfo }}</span>
      <button v-if="query || streamFilter !== 'all'" class="btn-ghost" @click="clearFilters">清除</button>
    </div>

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
          <p class="hint">启动后,stdout / stderr 将逐行流式滚动到这里</p>
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
        <p class="hint">从左侧选择一条命令,或直接启动查看实时日志</p>
      </div>

      <div v-if="sel && paused && lines && lines.length > 0" class="resume-row">
        <button class="btn-secondary resume-chip" @click="resumeAutoScroll">自动滚动已暂停 — 恢复</button>
      </div>
    </div>
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

.log-header {
  display: flex;
  align-items: center;
  gap: var(--space-lg);
  padding: var(--space-md) var(--space-lg);
  border-bottom: 1px solid var(--color-muted);
  background: var(--color-card);
  flex: none;
}

.log-title {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  min-width: 0;
}
.row-icon {
  width: 14px;
  height: 14px;
  flex: none;
  color: var(--color-muted-foreground);
}
.log-name {
  font-weight: 600;
  font-size: 14px;
  white-space: nowrap;
}
.log-proj {
  font-size: 12px;
  color: var(--color-muted-foreground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.meta {
  font: 400 11px/1.6 var(--font-mono);
  color: var(--color-muted-foreground);
  white-space: nowrap;
}
.spacer {
  flex: 1;
}

.log-body {
  position: relative;
  flex: 1;
  min-height: 0;
}
.log-viewer {
  height: 100%;
}

.log-filter-row {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-sm) var(--space-lg);
  border-bottom: 1px solid var(--color-muted);
  background: var(--color-background);
  flex: none;
}
.log-search {
  width: 260px;
  padding: 3px 10px;
  font-size: 12px;
}
.log-stream-filter {
  width: 110px;
  padding: 3px 8px;
  font-size: 12px;
}
.match-info {
  font: 400 11px/1.6 var(--font-mono);
  color: var(--color-muted-foreground);
  white-space: nowrap;
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
}
</style>
