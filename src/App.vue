<script setup>
// 应用外壳:工具条(分组/方案/导入导出/设置)+ 左监视 / 右终端双面板 + 可拖拽分隔条(键盘可达)。
import { computed, defineAsyncComponent, onMounted, ref } from "vue";
import { ListChecks, Play, Plus, Settings as SettingsIcon, Upload, Download, Zap } from "lucide-vue-next";
import {
  addCommand,
  addGroup,
  addProject,
  addScenario,
  commandKey,
  exportConfigToFile,
  importConfigFromFile,
  initStore,
  removeScenario,
  runScenario,
  updateCommand,
  updateGroup,
  updateProject,
  updateScenario,
  updateSettings,
  store,
} from "./stores/app.js";
import SidebarPane from "./components/SidebarPane.vue";
import LogPane from "./components/LogPane.vue";

const EditDialog = defineAsyncComponent(() => import("./components/EditDialog.vue"));
const SettingsDialog = defineAsyncComponent(() => import("./components/SettingsDialog.vue"));
const ScenarioDialog = defineAsyncComponent(() => import("./components/ScenarioDialog.vue"));

onMounted(() => {
  initStore();
});

// ---- 面板分隔条 ----
const SIDEBAR_MIN = 260;
const SIDEBAR_MAX = 640;
const sidebarWidth = ref(360);

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

// ---- 新建 / 编辑对话框(分组、项目、命令) ----
const dialog = ref(null);

function openCreate(payload) {
  dialog.value = { kind: payload.kind, group: payload.group ?? null, project: payload.project ?? null };
}

function openEdit(payload) {
  dialog.value = payload;
}

function closeDialog() {
  dialog.value = null;
}

const dialogTitle = computed(() => {
  const d = dialog.value;
  if (!d) return "";
  const editing = Boolean(d.group || d.project || d.command);
  if (d.kind === "command") return editing ? "编辑命令" : "新建命令";
  if (d.kind === "project") return editing ? "编辑项目" : "新建项目";
  return editing ? "重命名分组" : "新建分组";
});

function submitDialog(form) {
  const d = dialog.value;
  if (!d) return;
  if (d.kind === "group") {
    if (d.group) updateGroup(d.group, form.name);
    else addGroup(form.name);
  } else if (d.kind === "project") {
    if (d.project) updateProject(d.project, form);
    else addProject(d.group, form);
  } else if (d.kind === "command") {
    if (d.command) {
      updateCommand(d.command, form);
      store.selectedKey.value = commandKey(d.project.id, d.command.id);
    } else {
      const cmd = addCommand(d.project, form);
      store.selectedKey.value = commandKey(d.project.id, cmd.id);
    }
  }
  closeDialog();
}

function toolbarNewGroup() {
  openCreate({ kind: "group" });
}

// ---- 设置对话框 ----
const settingsOpen = ref(false);

function submitSettings(form) {
  updateSettings(form);
  settingsOpen.value = false;
}

// ---- 运行方案 ----
const scenarioOpen = ref(false); // null = 关闭;{} = 新建;{scenario} = 编辑
const activeScenarioId = ref("");

const activeScenario = computed(() =>
  store.scenarios.value.find((s) => s.id === activeScenarioId.value) ?? null,
);

function scenarioChanged(e) {
  if (e.target.value === "__manage__") {
    activeScenarioId.value = "";
    scenarioOpen.value = {};
    return;
  }
  activeScenarioId.value = e.target.value;
}

async function runActiveScenario() {
  if (!activeScenario.value) return;
  const n = await runScenario(activeScenario.value);
  if (n === 0) window.alert("方案里的命令都已在运行,或已不存在");
}

function submitScenario(form) {
  const editing = scenarioOpen.value?.scenario;
  if (editing) updateScenario(editing, form.name, form.items);
  else addScenario(form.name, form.items);
  scenarioOpen.value = null;
}

function onDeleteScenario() {
  const s = scenarioOpen.value?.scenario;
  if (!s) return;
  if (window.confirm(`删除方案「${s.name}」?`)) {
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
    <header class="toolbar">
      <span class="brand" title="XON — XON/XOFF:启动即流,停止即断">
        <Zap :size="14" aria-hidden="true" />XON
      </span>
      <span class="toolbar-sep" aria-hidden="true"></span>
      <button class="btn-ghost" @click="toolbarNewGroup"><Plus />新建分组</button>

      <template v-if="store.scenarios.value.length > 0">
        <span class="toolbar-sep" aria-hidden="true"></span>
        <select
          class="select scenario-select"
          aria-label="选择运行方案"
          :value="activeScenarioId"
          @change="scenarioChanged"
        >
          <option value="">运行方案…</option>
          <option v-for="s in store.scenarios.value" :key="s.id" :value="s.id">{{ s.name }}({{ s.items.length }})</option>
          <option value="__manage__">管理方案…</option>
        </select>
        <button
          class="btn-ghost"
          :disabled="!activeScenario"
          :aria-label="`运行方案 ${activeScenario?.name ?? ''}`"
          @click="runActiveScenario"
        >
          <Play />批量启动
        </button>
      </template>

      <span class="spacer" />
      <button class="btn-ghost" title="导出配置" aria-label="导出配置" @click="onExport"><Download /></button>
      <button class="btn-ghost" title="导入配置" aria-label="导入配置" @click="onImport"><Upload /></button>
      <button class="btn-ghost" title="设置" aria-label="设置" @click="settingsOpen = true"><SettingsIcon /></button>
      <span class="running-chip" :class="{ active: store.runningCount.value > 0 }">
        <span class="dot" aria-hidden="true"></span>
        运行中 {{ store.runningCount.value }}
      </span>
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
      :initial="dialog.command ?? dialog.project ?? dialog.group ?? {}"
      :defaults="{ dir: dialog.project?.dir ?? '' }"
      @submit="submitDialog"
      @cancel="closeDialog"
    />

    <SettingsDialog
      v-if="settingsOpen"
      :initial="store.config.settings"
      @submit="submitSettings"
      @cancel="settingsOpen = false"
    />

    <div v-if="scenarioOpen" class="scenario-wrap">
      <ScenarioDialog
        :key="scenarioOpen.scenario?.id ?? 'new'"
        :initial="scenarioOpen.scenario ?? null"
        @submit="submitScenario"
        @cancel="scenarioOpen = null"
        @pick="(s) => (scenarioOpen = { scenario: s })"
      />
      <button v-if="scenarioOpen.scenario" class="btn-danger scenario-delete" @click="onDeleteScenario">
        删除此方案
      </button>
    </div>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-lg);
  padding: var(--space-sm) var(--space-lg);
  background: var(--color-primary);
  border-bottom: 1px solid var(--color-border);
  flex: none;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: var(--space-sm);
  font: 700 13px/1 var(--font-mono);
  letter-spacing: 0.08em;
  color: var(--color-foreground);
  text-shadow: 0 0 10px var(--color-accent-glow-soft);
}

.toolbar-sep {
  width: 1px;
  height: 16px;
  background: var(--color-border);
}

.scenario-select {
  width: auto;
  min-width: 130px;
  padding: 4px 8px;
  font-size: 12px;
}

.spacer {
  flex: 1;
}

.running-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-sm);
  padding: 2px 10px;
  border-radius: var(--radius-sm);
  font: 500 11px/1.6 var(--font-ui);
  color: var(--color-muted-foreground);
  border: 1px solid rgba(148, 163, 184, 0.3);
  background: rgba(148, 163, 184, 0.12);
}
.running-chip .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-muted-foreground);
}
.running-chip.active {
  color: var(--color-accent-text);
  border-color: var(--color-accent-soft-border);
  background: var(--color-accent-soft-bg);
}
.running-chip.active .dot {
  background: var(--color-accent);
  box-shadow: 0 0 10px var(--color-accent-glow);
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
  width: 5px;
  cursor: col-resize;
  background: transparent;
  transition: background var(--dur-fast) var(--ease);
}
.splitter:hover,
.splitter:focus-visible {
  background: var(--color-secondary);
}

.scenario-wrap {
  position: relative;
}
.scenario-delete {
  position: absolute;
  bottom: 28px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 60;
}
</style>
