<script setup>
// 右侧终端面板:多标签(Tabs)+ 高密度日志查看器 + 底部轻量状态栏
import {
  CheckSquare,
  Copy,
  Eraser,
  ExternalLink,
  Play,
  Pause,
  RotateCw,
  Search,
  Square,
  Terminal,
  X,
} from "lucide-vue-next";
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { openBrowserUrl } from "../api.js";
import ContextMenu from "./ContextMenu.vue";
import {
  clearLog,
  commandKey,
  formatDuration,
  formatTime,
  locateCommand,
  notify,
  restartCommand,
  runningOf,
  selectFirstCommand,
  startCommand,
  stopPid,
  store,
} from "../stores/app.js";
import { parseAnsiLine } from "../utils/ansi.js";

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

// ---- ANSI 与高密度日志渲染 ----
// 日志行对象入缓冲后不再变化,按行 id 缓存解析结果,避免滚屏/搜索时重复解析。
// 单行解析结果约 0.5KB,上限 1 万条约 5MB,足以覆盖多个标签页各 5000 行的缓冲。
const ANSI_CACHE_MAX = 10000;
const ansiCache = new Map();

const URL_REGEX = /(?:https?:\/\/[^\s"'`<>]+|\b(?:localhost|127\.0\.0\.1):\d+(?:\/[^\s"'`<>]*)?)/gi;

function hasPossibleUrl(str) {
  return (
    str.includes("http://") ||
    str.includes("https://") ||
    str.includes("localhost:") ||
    str.includes("127.0.0.1:")
  );
}

function sanitizeUrl(raw) {
  let url = raw;
  while (/[.,;:!?)\]]$/.test(url)) {
    if (url.endsWith(")")) {
      const opens = (url.match(/\(/g) || []).length;
      const closes = (url.match(/\)/g) || []).length;
      if (opens >= closes) break;
    }
    url = url.slice(0, -1);
  }
  return url;
}

function findUrlsInPlain(plain) {
  if (!hasPossibleUrl(plain)) return [];
  URL_REGEX.lastIndex = 0;
  const urls = [];
  let match;
  while ((match = URL_REGEX.exec(plain)) !== null) {
    const raw = match[0];
    const clean = sanitizeUrl(raw);
    if (!clean) continue;
    const start = match.index;
    const end = start + clean.length;
    const href =
      clean.startsWith("http://") || clean.startsWith("https://")
        ? clean
        : `http://${clean}`;
    urls.push({ start, end, href, text: clean });
    URL_REGEX.lastIndex = match.index + raw.length;
  }
  return urls;
}

/**
 * 将整行 plain 文本中检测到的 URL 绝对跨度,映射对齐回各个 ANSI 切片。
 * 完美解决 CLI 工具(如 Vite)将 URL 中间端口加粗导致切片截断的问题,
 * 确保整条 URL(含协议、主机、端口、路径)完整识别、完整下划线且能全局点击。
 */
function alignSegmentsWithUrls(segs, plain, styled) {
  const urls = findUrlsInPlain(plain);
  if (urls.length === 0) {
    return { tokens: segs, hasTokens: styled };
  }

  const tokens = [];
  let pos = 0;
  let urlIdx = 0;

  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const segText = seg.text;
    if (!segText) continue;

    const segStart = pos;
    const segEnd = pos + segText.length;
    pos = segEnd;

    while (urlIdx < urls.length && urls[urlIdx].end <= segStart) {
      urlIdx++;
    }

    let cursor = segStart;
    let localUrlIdx = urlIdx;

    while (cursor < segEnd && localUrlIdx < urls.length) {
      const u = urls[localUrlIdx];
      if (u.start >= segEnd) {
        break;
      }

      if (cursor < u.start) {
        const sliceEnd = Math.min(segEnd, u.start);
        tokens.push({
          text: segText.slice(cursor - segStart, sliceEnd - segStart),
          style: seg.style,
          url: null,
        });
        cursor = sliceEnd;
      }

      if (cursor < segEnd && cursor >= u.start && cursor < u.end) {
        const sliceEnd = Math.min(segEnd, u.end);
        tokens.push({
          text: segText.slice(cursor - segStart, sliceEnd - segStart),
          style: seg.style,
          url: u.href,
        });
        cursor = sliceEnd;
      }

      if (cursor >= u.end) {
        localUrlIdx++;
      }
    }

    if (cursor < segEnd) {
      tokens.push({
        text: segText.slice(cursor - segStart),
        style: seg.style,
        url: null,
      });
    }
  }

  return { tokens, hasTokens: true };
}

function tokenizeSegments(segs, styled, plain) {
  return alignSegmentsWithUrls(segs, plain, styled);
}

function cleanSysText(text) {
  if (!text) return "";
  let clean = text.replace(/^—\s*|\s*—$/g, "").trim();
  clean = clean.replace(/:([^\s])/g, ": $1");
  clean = clean.replace(/,([^\s])/g, ", $1");
  return clean;
}

function classifySys(text) {
  if (!text) return { kind: "info", clean: "" };
  const clean = cleanSysText(text);
  if (/异常退出|\bexit\s+[1-9]\d*|failed|crash/i.test(clean)) {
    return { kind: "error", clean };
  }
  if (/启动|started|running/i.test(clean)) {
    return { kind: "start", clean };
  }
  if (/停止|退出|已终止|exit/i.test(clean)) {
    return { kind: "stop", clean };
  }
  return { kind: "info", clean };
}

function classifyLine(stream, text) {
  if (!text) return "";
  if (
    /(?:^|\b)(?:error|err|fatal|panic|exception)(?:\b|:)/i.test(text) &&
    !/(?:0 errors|no errors|without error)/i.test(text)
  ) {
    return "is-error";
  }
  if (stream === "err" || /(?:^|\b)(?:warn|warning)(?:\b|:)/i.test(text)) {
    return "is-warning";
  }
  return "";
}

function ansiOf(line) {
  let hit = ansiCache.get(line.id);
  if (!hit) {
    const rawParsed = parseAnsiLine(line.text);
    const lineClass = classifyLine(line.stream, rawParsed.plain);
    let sysKind = "info";
    let cleanSys = "";
    if (line.stream === "sys") {
      const res = classifySys(rawParsed.plain);
      sysKind = res.kind;
      cleanSys = res.clean;
    }
    const { tokens, hasTokens } = tokenizeSegments(rawParsed.segs, rawParsed.styled, rawParsed.plain);
    hit = {
      plain: rawParsed.plain,
      styled: rawParsed.styled,
      segs: rawParsed.segs,
      tokens,
      hasTokens,
      lineClass,
      sysKind,
      cleanSys,
    };
    if (ansiCache.size >= ANSI_CACHE_MAX) {
      let drop = Math.floor(ANSI_CACHE_MAX / 4);
      for (const key of ansiCache.keys()) {
        ansiCache.delete(key);
        if (--drop <= 0) break;
      }
    }
    ansiCache.set(line.id, hit);
  }
  return hit;
}

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
    // 用去掉转义序列的纯文本匹配,避免 ANSI 参数干扰搜索结果
    list = list.filter((l) => ansiOf(l).plain.toLowerCase().includes(q));
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
const paused = computed(() => manualPaused.value || scrolledUp.value);

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

// ---- 右键上下文菜单 (Context Menu) ----
const contextMenu = ref({ visible: false, x: 0, y: 0, items: [] });

async function copyText(text, successMsg) {
  try {
    await navigator.clipboard.writeText(text);
    notify(successMsg);
  } catch (err) {
    console.error("复制失败:", err);
  }
}

function selectAllLogs() {
  if (!bodyRef.value) return;
  const range = document.createRange();
  range.selectNodeContents(bodyRef.value);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function onLogContextMenu(e) {
  const linkEl = e.target.closest(".log-link");
  const linkUrl = linkEl ? linkEl.getAttribute("href") : null;
  const selText = window.getSelection()?.toString()?.trim() || "";

  const items = [];

  if (linkUrl) {
    items.push({
      label: "在默认浏览器中打开",
      icon: ExternalLink,
      action: () => openBrowserUrl(linkUrl),
    });
    items.push({
      label: "复制链接地址",
      icon: Copy,
      action: () => copyText(linkUrl, "链接已复制到剪贴板"),
    });
    items.push({ divider: true });
  }

  if (selText) {
    items.push({
      label: "复制",
      icon: Copy,
      badge: "Ctrl+C",
      action: () => copyText(selText, "已复制到剪贴板"),
    });
  }

  items.push({
    label: "全选日志",
    icon: CheckSquare,
    badge: "Ctrl+A",
    action: selectAllLogs,
  });

  items.push({ divider: true });

  items.push({
    label: "清空日志",
    icon: Eraser,
    action: onClear,
  });

  items.push({
    label: paused.value ? "恢复自动滚动" : "暂停自动滚动",
    icon: paused.value ? Play : Pause,
    action: () => {
      if (paused.value) resumeAutoScroll();
      else manualPaused.value = true;
    },
  });

  contextMenu.value = {
    visible: true,
    x: e.clientX,
    y: e.clientY,
    items,
  };
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
    <div class="log-body" @contextmenu.prevent="onLogContextMenu">
      <div
        v-if="sel"
        ref="bodyRef"
        class="log-viewer"
        @scroll="onScroll"
      >
        <template v-for="line in filteredLines" :key="line.id">
          <!-- 系统事件分割线 (已启动/退出/停止/异常) -->
          <div
            v-if="line.stream === 'sys'"
            v-memo="[line.id]"
            class="log-sys-divider"
            :class="`is-${ansiOf(line).sysKind}`"
          >
            <span class="sys-dash"></span>
            <div class="sys-badge">
              <span class="sys-dot"></span>
              <span class="sys-ts">{{ formatTime(line.ts) }}</span>
              <span class="sys-text">{{ ansiOf(line).cleanSys }}</span>
            </div>
            <span class="sys-dash"></span>
          </div>

          <!-- 常规日志行 (stdout / stderr) -->
          <div
            v-else
            v-memo="[line.id]"
            class="log-line"
            :class="ansiOf(line).lineClass"
          >
            <span class="log-ts">{{ formatTime(line.ts) }}</span>
            <span :class="streamClass(line.stream)">
              <template v-if="ansiOf(line).hasTokens">
                <template v-for="(tok, ti) in ansiOf(line).tokens" :key="ti">
                  <a
                    v-if="tok.url"
                    :href="tok.url"
                    class="log-link"
                    :style="tok.style"
                    :title="`在默认浏览器中打开 ${tok.url}`"
                    @click.stop.prevent="openBrowserUrl(tok.url)"
                  >{{ tok.text }}</a>
                  <span v-else-if="tok.style" :style="tok.style">{{ tok.text }}</span>
                  <template v-else>{{ tok.text }}</template>
                </template>
              </template>
              <template v-else>{{ ansiOf(line).plain }}</template>
            </span>
          </div>
        </template>

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

    <!-- 右键上下文菜单 -->
    <ContextMenu
      v-if="contextMenu.visible"
      :x="contextMenu.x"
      :y="contextMenu.y"
      :items="contextMenu.items"
      @close="contextMenu.visible = false"
    />
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
