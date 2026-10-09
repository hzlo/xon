<script setup>
// 应用外壳:自定义标题栏(Run Configuration 方案胶囊/窗口控制)+ 工具条
// + 左侧无限嵌套分组树 / 右侧实时终端,双面板可拖拽调整宽度。
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref, watch } from "vue";
import {
  ChevronDown,
  Download,
  Play,
  Plus,
  Settings as SettingsIcon,
  Square,
  Upload,
  Zap,
} from "lucide-vue-next";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  addCommand,
  addGroup,
  addProject,
  addScenario,
  commandKey,
  confirmAction,
  exportConfigToFile,
  importConfigFromFile,
  initStore,
  notify,
  removeScenario,
  runScenario,
  stopAll,
  updateCommand,
  updateGroup,
  updateProject,
  updateScenario,
  updateSettings,
  store,
} from "./stores/app.js";
import { isTauri } from "./api.js";
import logoColor from "./assets/logo-color.svg";
import SidebarPane from "./components/SidebarPane.vue";
import LogPane from "./components/LogPane.vue";

import { checkUpdate } from "./updater.js";

const EditDialog = defineAsyncComponent(() => import("./components/EditDialog.vue"));
const SettingsDialog = defineAsyncComponent(() => import("./components/SettingsDialog.vue"));
const ScenarioDialog = defineAsyncComponent(() => import("./components/ScenarioDialog.vue"));
const ConfirmDialog = defineAsyncComponent(() => import("./components/ConfirmDialog.vue"));
const ToastStack = defineAsyncComponent(() => import("./components/ToastStack.vue"));
const UpdateDialog = defineAsyncComponent(() => import("./components/UpdateDialog.vue"));

const activeUpdate = ref(null);
const currentAppVersion = "0.1.0";

// ---- 窗口控制(自定义标题栏;浏览器预览下不渲染) ----
const appWindow = isTauri ? getCurrentWindow() : null;
const isMaximized = ref(false);

async function toggleMaximize() {
  if (!appWindow) return;
  await appWindow.toggleMaximize();
  isMaximized.value = await appWindow.isMaximized();
}

function onTitlebarDblClick(e) {
  if (e.target.hasAttribute("data-tauri-drag-region")) {
    toggleMaximize();
  }
}

onMounted(() => {
  initStore();
  window.addEventListener("click", closeScenarioMenu);

  if (appWindow) {
    appWindow.isMaximized().then((m) => {
      isMaximized.value = m;
    });
    appWindow.onResized(async () => {
      isMaximized.value = await appWindow.isMaximized();
    });
  }

  // 启动 4 秒后静默检查更新(首屏轻量加载)
  setTimeout(async () => {
    try {
      const u = await checkUpdate();
      if (u) {
        activeUpdate.value = u;
      }
    } catch {
      // 静默检查，忽略错误
    }
  }, 4000);
});

onUnmounted(() => {
  window.removeEventListener("click", closeScenarioMenu);
});

const logoSrc = computed(() => logoColor);

// ---- 面板分隔条 ----
const SIDEBAR_MIN = 240;
const SIDEBAR_MAX = 600;
const sidebarWidth = ref(300);

function onSplitterPointerdown(e) {
  e.preventDefault();
  const startX = e.clientX;
  const startWidth = sidebarWidth.value;
  const target = e.currentTarget;
  target.setPointerCapture(e.pointerId);

  const onMove = (ev) => {
    sidebarWidth.value = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startWidth + ev.clientX - startX));
  };
  const onUp = () => {
    target.removeEventListener("pointermove", onMove);
    target.removeEventListener("pointerup", onUp);
  };
  target.addEventListener("pointermove", onMove);
  target.addEventListener("pointerup", onUp);
}

function onSplitterKeydown(e) {
  if (e.key === "ArrowLeft") {
    sidebarWidth.value = Math.max(SIDEBAR_MIN, sidebarWidth.value - 16);
  } else if (e.key === "ArrowRight") {
    sidebarWidth.value = Math.min(SIDEBAR_MAX, sidebarWidth.value + 16);
  } else {
    return;
  }
  e.preventDefault();
}

// ---- 新建 / 编辑对话框(分组、项目、命令;mode 区分新建/编辑) ----
const dialog = ref(null);

function openCreate(payload) {
  dialog.value = { kind: payload.kind, mode: "create", parentGroup: payload.parentGroup ?? null, project: payload.project ?? null };
}

function openEdit(payload) {
  dialog.value = { ...payload, mode: "edit" };
}

function closeDialog() {
  dialog.value = null;
}

const dialogTitle = computed(() => {
  const d = dialog.value;
  if (!d) return "";
  if (d.mode === "edit") {
    if (d.kind === "command") return "编辑命令";
    if (d.kind === "project") return "编辑项目";
    return "重命名分组";
  }
  if (d.kind === "command") return "新建命令";
  if (d.kind === "project") return d.parentGroup ? `在「${d.parentGroup.name}」中新建项目` : "新建项目";
  return d.parentGroup ? `在「${d.parentGroup.name}」中新建子分组` : "新建分组";
});

const dialogInitial = computed(() => {
  const d = dialog.value;
  if (!d || d.mode !== "edit") return {};
  return d.command ?? d.project ?? d.group ?? {};
});

function submitDialog(form) {
  const d = dialog.value;
  if (!d) return;
  if (d.kind === "group") {
    if (d.mode === "edit") updateGroup(d.group, form.name);
    else addGroup(d.parentGroup?.id ?? null, form.name);
  } else if (d.kind === "project") {
    if (d.mode === "edit") updateProject(d.project, form);
    else addProject(d.parentGroup, form);
  } else if (d.kind === "command") {
    if (d.mode === "edit") {
      updateCommand(d.command, form);
      store.selectedKey.value = commandKey(d.project.id, d.command.id);
    } else {
      const cmd = addCommand(d.project, form);
      store.selectedKey.value = commandKey(d.project.id, cmd.id);
    }
  }
  closeDialog();
}

// ---- 设置对话框 ----
const settingsOpen = ref(false);

function submitSettings(form) {
  updateSettings(form);
  settingsOpen.value = false;
}

// ---- 运行方案 (Run Configuration) ----
const scenarioOpen = ref(null); // null = 关闭; {} = 新建; {scenario} = 编辑
const activeScenarioId = ref("");
const scenarioMenuOpen = ref(false);

const activeScenario = computed(() =>
  store.scenarios.value.find((s) => s.id === activeScenarioId.value) ?? null,
);

watch(
  () => store.scenarios.value,
  (list) => {
    if (!activeScenarioId.value && list && list.length > 0) {
      activeScenarioId.value = list[0].id;
    }
  },
  { immediate: true },
);

function closeScenarioMenu(e) {
  if (!e.target.closest(".run-config-pill")) {
    scenarioMenuOpen.value = false;
  }
}

function selectScenario(id) {
  activeScenarioId.value = id;
  scenarioMenuOpen.value = false;
}

function openNewScenario() {
  scenarioMenuOpen.value = false;
  scenarioOpen.value = {};
}

function openManageScenario() {
  scenarioMenuOpen.value = false;
  if (activeScenario.value) {
    scenarioOpen.value = { scenario: activeScenario.value };
  } else {
    scenarioOpen.value = {};
  }
}

async function runActiveScenario() {
  if (!activeScenario.value) return;
  const n = await runScenario(activeScenario.value);
  if (n === 0) notify("方案里的命令都已在运行,或已不存在");
}

function submitScenario(form) {
  const editing = scenarioOpen.value?.scenario;
  if (editing) updateScenario(editing, form.name, form.items);
  else {
    const s = addScenario(form.name, form.items);
    activeScenarioId.value = s.id;
  }
  scenarioOpen.value = null;
}

async function onDeleteScenario() {
  const s = scenarioOpen.value?.scenario;
  if (!s) return;
  if (await confirmAction(`删除方案「${s.name}」?`, { title: "删除方案", danger: true })) {
    removeScenario(s);
    if (activeScenarioId.value === s.id) activeScenarioId.value = "";
    scenarioOpen.value = null;
  }
}

// ---- 导入 / 导出 ----
async function onExport() {
  await exportConfigToFile();
}

async function onImport() {
  await importConfigFromFile();
}
</script>

<template>
  <div class="app">
    <header class="titlebar" data-tauri-drag-region @dblclick="onTitlebarDblClick">
      <!-- 左侧：品牌 Logo 与名称 -->
      <div class="brand-group" data-tauri-drag-region>
        <img class="brand-logo" :src="logoSrc" alt="XON" draggable="false" />
        <span class="brand-name">XON</span>
      </div>

      <span class="spacer drag-fill" data-tauri-drag-region></span>

      <!-- 中间：Run Configuration 运行方案胶囊 -->
      <div class="run-config-pill">
        <div
          class="scenario-picker-trigger"
          title="切换运行方案"
          @click.stop="scenarioMenuOpen = !scenarioMenuOpen"
        >
          <Zap class="pill-icon" />
          <span class="scenario-name">{{ activeScenario?.name || '选择运行方案…' }}</span>
          <span v-if="activeScenario" class="scenario-count">({{ activeScenario.items.length }})</span>
          <ChevronDown class="pill-chevron" />
        </div>

        <!-- 方案下拉菜单浮层 -->
        <div v-if="scenarioMenuOpen" class="scenario-dropdown-menu">
          <div v-if="store.scenarios.value.length === 0" class="menu-empty">
            暂无运行方案
          </div>
          <button
            v-for="s in store.scenarios.value"
            :key="s.id"
            class="menu-item"
            :class="{ active: s.id === activeScenarioId }"
            @click="selectScenario(s.id)"
          >
            <span class="menu-item-name">{{ s.name }}</span>
            <span class="menu-item-count">{{ s.items.length }} 个命令</span>
          </button>

          <div class="menu-sep"></div>

          <button class="menu-item action-item" @click="openNewScenario">
            <Plus class="item-icon" />
            <span>新建运行方案…</span>
          </button>
          <button v-if="activeScenario" class="menu-item action-item" @click="openManageScenario">
            <SettingsIcon class="item-icon" />
            <span>编辑当前方案…</span>
          </button>
        </div>

        <span class="pill-sep" aria-hidden="true"></span>

        <!-- 启动方案按钮 -->
        <button
          class="pill-action-btn run-btn"
          :disabled="!activeScenario"
          :title="activeScenario ? `批量启动方案: ${activeScenario.name}` : '请先选择方案'"
          @click="runActiveScenario"
        >
          <Play class="pill-action-icon" />
          <span>启动方案</span>
        </button>

        <!-- 全部停止按钮 (运行中进程 > 0 时激活) -->
        <button
          v-if="store.runningCount.value > 0"
          class="pill-action-btn stop-btn"
          title="停止全部运行中进程"
          @click="stopAll"
        >
          <Square class="pill-action-icon" />
        </button>
      </div>

      <span class="spacer drag-fill" data-tauri-drag-region></span>

      <!-- 右侧：全局监控与设置 -->
      <div class="titlebar-right" data-tauri-drag-region>
        <span class="running-chip" :class="{ active: store.runningCount.value > 0 }">
          <span class="dot" aria-hidden="true"></span>
          {{ store.runningCount.value }} 运行中
        </span>

        <button class="btn-ghost icon-btn" title="导出配置" aria-label="导出配置" @click="onExport"><Download /></button>
        <button class="btn-ghost icon-btn" title="导入配置" aria-label="导入配置" @click="onImport"><Upload /></button>
        <button class="btn-ghost icon-btn" title="设置" aria-label="设置" @click="settingsOpen = true"><SettingsIcon /></button>
      </div>

      <div v-if="appWindow" class="win-controls">
        <button class="win-btn" aria-label="最小化" title="最小化" @click="appWindow.minimize()">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <path d="M0 5H10" stroke="currentColor" stroke-width="1.2" />
          </svg>
        </button>
        <button
          class="win-btn"
          :aria-label="isMaximized ? '还原' : '最大化'"
          :title="isMaximized ? '还原' : '最大化'"
          @click="toggleMaximize"
        >
          <!-- 还原: 两个交叠方框 -->
          <svg v-if="isMaximized" width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <path d="M2.5 2V0.75H9.25V7.5H8" stroke="currentColor" stroke-width="1.1" />
            <rect x="0.75" y="2.5" width="6.75" height="6.75" stroke="currentColor" stroke-width="1.1" />
          </svg>
          <!-- 最大化: 单个矩形方框 -->
          <svg v-else width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <rect x="0.75" y="0.75" width="8.5" height="8.5" stroke="currentColor" stroke-width="1.1" />
          </svg>
        </button>
        <button class="win-btn win-close" aria-label="关闭窗口" title="关闭" @click="appWindow.close()">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
          </svg>
        </button>
      </div>
    </header>

    <main class="workspace">
      <aside class="sidebar" :style="{ width: `${sidebarWidth}px` }" aria-label="项目分组">
        <SidebarPane @edit="openEdit" @create="openCreate" />
      </aside>

      <div
        class="splitter"
        role="separator"
        aria-orientation="vertical"
        aria-label="拖拽或用左右方向键调整面板宽度"
        :aria-valuenow="sidebarWidth"
        :aria-valuemin="SIDEBAR_MIN"
        :aria-valuemax="SIDEBAR_MAX"
        tabindex="0"
        @pointerdown="onSplitterPointerdown"
        @keydown="onSplitterKeydown"
      ></div>

      <LogPane />
    </main>

    <EditDialog
      v-if="dialog"
      :kind="dialog.kind"
      :title="dialogTitle"
      :initial="dialogInitial"
      :defaults="{ dir: dialog.project?.dir ?? dialog.parentGroup?.projects?.[0]?.dir ?? '' }"
      @submit="submitDialog"
      @cancel="closeDialog"
    />

    <SettingsDialog
      v-if="settingsOpen"
      :initial="store.config.settings"
      @submit="submitSettings"
      @cancel="settingsOpen = false"
      @show-update="(u) => { activeUpdate = u; settingsOpen = false; }"
    />

    <UpdateDialog
      v-if="activeUpdate"
      :update="activeUpdate"
      :current-version="currentAppVersion"
      @close="activeUpdate = null"
    />

    <ConfirmDialog />
    <ToastStack />
    <ScenarioDialog
      v-if="scenarioOpen"
      :key="scenarioOpen.scenario?.id ?? 'new'"
      :initial="scenarioOpen.scenario ?? null"
      @submit="submitScenario"
      @cancel="scenarioOpen = null"
      @pick="(s) => (scenarioOpen = s ? { scenario: s } : {})"
      @delete="onDeleteScenario"
    />
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.titlebar {
  position: relative;
  z-index: 100;
  display: flex;
  align-items: center;
  padding-left: var(--space-md);
  height: 38px;
  background: var(--glass-panel-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border-bottom: 1px solid var(--glass-border);
  box-shadow: var(--glass-highlight);
  flex: none;
  user-select: none;
}

.brand-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.brand-logo {
  height: 20px;
  width: auto;
  flex: none;
  pointer-events: none;
}

.brand-name {
  font-weight: 600;
  font-size: 0.95rem;
  letter-spacing: 0.05em;
  color: var(--color-foreground);
}

.spacer {
  flex: 1;
  align-self: stretch;
}

/* 居中 Run Configuration 运行方案胶囊 */
.run-config-pill {
  position: relative;
  display: inline-flex;
  align-items: center;
  background: var(--input-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 2px 4px;
  height: 28px;
  box-shadow: var(--shadow-sm);
  user-select: none;
}

.scenario-picker-trigger {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 0.85rem;
  color: var(--color-foreground);
  transition: background var(--dur-fast) var(--ease);
}
.scenario-picker-trigger:hover {
  background: var(--overlay-hover);
}

.pill-icon {
  width: 13px;
  height: 13px;
  color: var(--color-accent);
}

.scenario-name {
  font-weight: 500;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.scenario-count {
  font-family: var(--font-mono);
  font-size: 0.8rem;
  color: var(--color-muted-foreground);
}

.pill-chevron {
  width: 11px;
  height: 11px;
  color: var(--color-muted-foreground);
  opacity: 0.7;
}

.pill-sep {
  width: 1px;
  height: 14px;
  background: var(--color-border);
  margin: 0 4px;
}

.pill-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  height: 22px;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 0.82rem;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease);
}

.run-btn {
  background: var(--color-accent);
  color: var(--color-on-accent);
}
.run-btn:hover:not(:disabled) {
  background: var(--color-accent-hover);
}
.run-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.stop-btn {
  background: var(--color-destructive-soft-bg);
  color: var(--color-destructive);
  padding: 2px 6px;
  margin-left: 3px;
}
.stop-btn:hover {
  background: var(--color-destructive-soft-border);
}

.pill-action-icon {
  width: 11px;
  height: 11px;
}

/* 方案下拉菜单浮层 */
.scenario-dropdown-menu {
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 6px;
  background: var(--color-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.55), 0 2px 8px rgba(0, 0, 0, 0.3);
  min-width: 220px;
  padding: 4px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  background: transparent;
  border: none;
  color: var(--color-foreground);
  font-size: 0.85rem;
  cursor: pointer;
  text-align: left;
  transition: background var(--dur-fast) var(--ease);
}
.menu-item:hover {
  background: var(--overlay-hover);
}
.menu-item.active {
  background: var(--overlay-selected);
  color: var(--color-accent);
}
.menu-item-name {
  font-weight: 500;
}
.menu-item-count {
  font-size: 0.8rem;
  color: var(--color-muted-foreground);
  font-family: var(--font-mono);
}
.menu-sep {
  height: 1px;
  background: var(--color-divider);
  margin: 3px 0;
}
.action-item {
  justify-content: flex-start;
  gap: 6px;
  color: var(--color-muted-foreground);
}
.action-item:hover {
  color: var(--color-foreground);
}
.item-icon {
  width: 13px;
  height: 13px;
}
.menu-empty {
  padding: 8px;
  font-size: 0.82rem;
  color: var(--color-muted-foreground);
  text-align: center;
}

.titlebar-right {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.running-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-sm);
  padding: 2px 10px;
  border-radius: var(--radius-sm);
  font: 500 0.82rem/1.6 var(--font-ui);
  color: var(--color-muted-foreground);
  border: 1px solid var(--color-border);
  background: var(--overlay-hover);
}
.running-chip .dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-muted-foreground);
}
.running-chip.active {
  color: var(--color-accent-text);
  border-color: var(--color-accent-soft-border);
  background: var(--color-accent-soft-bg);
}
.running-chip.active .dot {
  background: var(--color-success, #A3BE8C);
  box-shadow: 0 0 6px rgba(163, 190, 140, 0.6);
}

/* 窗口控制按钮:贴右缘、占满标题栏高度、精致极简风格 */
.win-controls {
  display: flex;
  align-self: stretch;
  flex: none;
  -webkit-app-region: no-drag;
}
.win-btn {
  width: 44px;
  height: 100%;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--color-muted-foreground);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}
.win-btn svg {
  pointer-events: none;
}
.win-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-foreground);
}
.win-btn:active {
  background: rgba(255, 255, 255, 0.14);
}
.win-close:hover {
  background: #e81123 !important;
  color: #ffffff !important;
}
.win-close:active {
  background: #c42b1c !important;
  color: #ffffff !important;
}

.workspace {
  display: flex;
  flex: 1;
  min-height: 0;
}

.sidebar {
  flex: none;
  background: var(--color-card);
  min-width: 0;
  overflow: hidden;
}

.splitter {
  flex: none;
  width: 1px;
  background: var(--color-divider);
  cursor: col-resize;
  position: relative;
  z-index: 10;
  transition: background var(--dur-fast) var(--ease);
}
.splitter::before {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: -3px;
  right: -3px;
  cursor: col-resize;
}
.splitter:hover,
.splitter:focus-visible {
  background: var(--color-accent);
  box-shadow: 0 0 6px var(--color-accent-glow);
}
</style>
