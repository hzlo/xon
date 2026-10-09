<script setup>
// 运行方案管理:命名 + 勾选要批量启动的命令(完整支持分组树与项目层级、三态勾选、极简延时)。
import { computed, nextTick, onBeforeUnmount, onMounted, provide, reactive, ref } from "vue";
import { Plus, Search, Trash2, X } from "lucide-vue-next";
import { commandKey, runningOf, store } from "../stores/app.js";
import ScenarioGroupNode from "./ScenarioGroupNode.vue";
import ScenarioProjectNode from "./ScenarioProjectNode.vue";

const props = defineProps({
  /** 编辑时传入 { id, name, items } */
  initial: { type: Object, default: null },
});
const emit = defineEmits(["submit", "cancel", "pick", "delete"]);

const form = reactive({
  name: props.initial?.name ?? "",
});

/** key → 勾选状态;提交时按配置树顺序输出,保证批量启动顺序稳定 */
const checked = reactive(
  Object.fromEntries((props.initial?.items ?? []).map((it) => [`${it.projectId}/${it.commandId}`, true])),
);

/** key → 独立延时(秒) */
const delays = reactive(
  Object.fromEntries(
    (props.initial?.items ?? []).map((it) => [`${it.projectId}/${it.commandId}`, it.delaySeconds || 0]),
  ),
);

const searchQuery = ref("");
const nameInput = ref(null);

/** 折叠状态存储 */
const collapsedGroups = reactive(new Set());
const collapsedProjects = reactive(new Set());

/** 配置树 → 扁平命令列表(保持原有天然顺序用于批量启动) */
const flatCommands = computed(() => {
  const out = [];
  const walkProject = (project, groupNames) => {
    for (const command of project.commands ?? []) {
      out.push({
        key: commandKey(project.id, command.id),
        projectId: project.id,
        commandId: command.id,
        groupPath: groupNames.join(" / "),
        projectName: project.name,
        name: command.name,
        cmd: command.cmd,
        port: command.port,
        project,
        command,
      });
    }
  };
  const walkGroup = (group, path) => {
    const next = [...path, group.name];
    for (const child of group.groups ?? []) walkGroup(child, next);
    for (const project of group.projects ?? []) walkProject(project, next);
  };
  for (const group of store.config.groups ?? []) walkGroup(group, []);
  for (const project of store.config.projects ?? []) walkProject(project, []);
  return out;
});

/** 选中的命令总数 */
const checkedCount = computed(() => {
  return flatCommands.value.filter((e) => checked[e.key]).length;
});

/* ------------------------------------------------------------- 搜索与过滤逻辑 */

function isCommandVisible(cmd, project) {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return true;
  if (cmd.name?.toLowerCase().includes(q)) return true;
  if (project?.name?.toLowerCase().includes(q)) return true;
  return false;
}

function isProjectVisible(project) {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return true;
  if (project.name?.toLowerCase().includes(q)) return true;
  return (project.commands ?? []).some((cmd) => isCommandVisible(cmd, project));
}

function isGroupVisible(group) {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return true;
  if (group.name?.toLowerCase().includes(q)) return true;
  const projectHit = (group.projects ?? []).some((p) => isProjectVisible(p));
  if (projectHit) return true;
  const subHit = (group.groups ?? []).some((sub) => isGroupVisible(sub));
  return subHit;
}

const matchCount = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return flatCommands.value.length;
  return flatCommands.value.filter((e) => isCommandVisible(e.command, e.project)).length;
});

/* ------------------------------------------------------------- 折叠展开控制 */

function isGroupCollapsed(groupId) {
  if (searchQuery.value.trim()) return false;
  return collapsedGroups.has(groupId);
}

function toggleGroupCollapse(groupId) {
  if (collapsedGroups.has(groupId)) collapsedGroups.delete(groupId);
  else collapsedGroups.add(groupId);
}

function isProjectCollapsed(projectId) {
  if (searchQuery.value.trim()) return false;
  return collapsedProjects.has(projectId);
}

function toggleProjectCollapse(projectId) {
  if (collapsedProjects.has(projectId)) collapsedProjects.delete(projectId);
  else collapsedProjects.add(projectId);
}

function expandAll() {
  collapsedGroups.clear();
  collapsedProjects.clear();
}

function collapseAll() {
  const walkGroup = (g) => {
    collapsedGroups.add(g.id);
    for (const p of g.projects ?? []) collapsedProjects.add(p.id);
    for (const sub of g.groups ?? []) walkGroup(sub);
  };
  for (const g of store.config.groups ?? []) walkGroup(g);
  for (const p of store.config.projects ?? []) collapsedProjects.add(p.id);
}

/* ------------------------------------------------------------- 树级三态勾选 */

function getProjectCommands(project) {
  return (project.commands ?? []).map((cmd) => ({
    key: commandKey(project.id, cmd.id),
    project,
    command: cmd,
  }));
}

function isProjectChecked(project) {
  const list = getProjectCommands(project);
  if (list.length === 0) return false;
  return list.every((item) => checked[item.key]);
}

function isProjectIndeterminate(project) {
  const list = getProjectCommands(project);
  if (list.length === 0) return false;
  const count = list.filter((item) => checked[item.key]).length;
  return count > 0 && count < list.length;
}

function toggleProject(project) {
  const list = getProjectCommands(project);
  if (list.length === 0) return;
  const allChecked = list.every((item) => checked[item.key]);
  const nextVal = !allChecked;
  for (const item of list) {
    checked[item.key] = nextVal;
  }
}

function getGroupCommands(group) {
  const out = [];
  const walk = (g) => {
    for (const p of g.projects ?? []) {
      for (const cmd of p.commands ?? []) {
        out.push({
          key: commandKey(p.id, cmd.id),
          project: p,
          command: cmd,
        });
      }
    }
    for (const sub of g.groups ?? []) walk(sub);
  };
  walk(group);
  return out;
}

function isGroupChecked(group) {
  const list = getGroupCommands(group);
  if (list.length === 0) return false;
  return list.every((item) => checked[item.key]);
}

function isGroupIndeterminate(group) {
  const list = getGroupCommands(group);
  if (list.length === 0) return false;
  const count = list.filter((item) => checked[item.key]).length;
  return count > 0 && count < list.length;
}

function toggleGroup(group) {
  const list = getGroupCommands(group);
  if (list.length === 0) return;
  const allChecked = list.every((item) => checked[item.key]);
  const nextVal = !allChecked;
  for (const item of list) {
    checked[item.key] = nextVal;
  }
}

function getGroupSelectedCount(group) {
  const list = getGroupCommands(group);
  return list.filter((item) => checked[item.key]).length;
}

function getGroupTotalCount(group) {
  return getGroupCommands(group).length;
}

function toggleCommand(key) {
  checked[key] = !checked[key];
}

/* ------------------------------------------------------------- 批量工具按钮 */

function selectAll() {
  const q = searchQuery.value.trim().toLowerCase();
  for (const entry of flatCommands.value) {
    if (!q || isCommandVisible(entry.command, entry.project)) {
      checked[entry.key] = true;
    }
  }
}

function clearAll() {
  for (const entry of flatCommands.value) {
    checked[entry.key] = false;
  }
}

/* ------------------------------------------------------------- 上下文注入 */

provide("scenarioContext", {
  checked,
  delays,
  commandKey,
  runningOf,
  isCommandVisible,
  isProjectVisible,
  isGroupVisible,
  isGroupCollapsed,
  toggleGroupCollapse,
  isProjectCollapsed,
  toggleProjectCollapse,
  isProjectChecked,
  isProjectIndeterminate,
  toggleProject,
  isGroupChecked,
  isGroupIndeterminate,
  toggleGroup,
  getGroupSelectedCount,
  getGroupTotalCount,
  toggleCommand,
});

/* ------------------------------------------------------------- 键盘与提交 */

function onKeydown(e) {
  if (e.key === "Escape") emit("cancel");
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  nextTick(() => nameInput.value?.focus());
});

onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));

function submit() {
  if (!form.name.trim()) return;
  const items = [];
  for (const entry of flatCommands.value) {
    if (checked[entry.key]) {
      items.push({
        projectId: entry.projectId,
        commandId: entry.commandId,
        delaySeconds: Math.max(0, Number(delays[entry.key]) || 0),
      });
    }
  }
  emit("submit", { name: form.name.trim(), items });
}

defineExpose({ checkedCount: () => checkedCount.value });
</script>

<template>
  <div class="modal-overlay" @click.self="emit('cancel')">
    <div class="modal scenario-modal" role="dialog" aria-modal="true" aria-label="运行方案">
      <!-- 首行:标题 + 方案切换胶囊 + 关闭 -->
      <header class="dialog-topbar">
        <div class="topbar-left">
          <h2 class="dialog-title">{{ initial ? "编辑方案" : "新建方案" }}</h2>
          <div v-if="store.scenarios.value.length > 0" class="scenario-tabs">
            <button
              v-for="s in store.scenarios.value"
              :key="s.id"
              type="button"
              class="tab-chip"
              :class="{ 'is-active': initial?.id === s.id }"
              @click="emit('pick', s)"
            >
              {{ s.name }} ({{ s.items?.length ?? 0 }})
            </button>
            <button
              v-if="initial"
              type="button"
              class="tab-chip chip-add"
              title="新建另一个方案"
              @click="emit('pick', null)"
            >
              <Plus class="chip-icon" />新建
            </button>
          </div>
        </div>

        <button class="btn-ghost icon-btn" title="关闭 (Esc)" aria-label="关闭" @click="emit('cancel')">
          <X />
        </button>
      </header>

      <form class="dialog-form" @submit.prevent="submit">
        <!-- 次行:名称 + 搜索过滤与批量操作 -->
        <div class="action-bar">
          <div class="name-box">
            <span class="bar-label">方案名称</span>
            <input
              id="scenario-name"
              ref="nameInput"
              v-model="form.name"
              autocomplete="off"
              spellcheck="false"
              autocapitalize="off"
              class="input name-input"
              type="text"
              placeholder="如: 开发环境全量启动"
            />
          </div>

          <div class="search-and-tools">
            <div class="search-wrap">
              <Search class="search-icon" />
              <input
                v-model="searchQuery"
                type="text"
                class="search-input"
                placeholder="搜索服务…"
              />
              <button
                v-if="searchQuery"
                type="button"
                class="search-clear"
                title="清空"
                @click="searchQuery = ''"
              >
                ×
              </button>
            </div>

            <span class="count-pill">
              已选 {{ checkedCount }}/{{ flatCommands.length }}
            </span>

            <div class="tool-btns">
              <button type="button" class="btn-ghost tool-btn" @click="selectAll">全选</button>
              <button type="button" class="btn-ghost tool-btn" @click="clearAll">清空</button>
              <span class="tool-sep"></span>
              <button type="button" class="btn-ghost tool-btn" @click="expandAll">展开</button>
              <button type="button" class="btn-ghost tool-btn" @click="collapseAll">折叠</button>
            </div>
          </div>
        </div>

        <!-- 纯净树状列表:完整保留分组与项目层级，无卡片套娃边框 -->
        <div class="tree-canvas">
          <!-- 分组节点 (递归包含子分组与项目) -->
          <ScenarioGroupNode
            v-for="group in store.config.groups ?? []"
            :key="group.id"
            :group="group"
            :depth="0"
          />

          <!-- 根级独立项目 -->
          <ScenarioProjectNode
            v-for="project in store.config.projects ?? []"
            :key="project.id"
            :project="project"
          />

          <!-- 空结果提示 -->
          <div v-if="flatCommands.length > 0 && matchCount === 0" class="canvas-empty">
            未找到与「{{ searchQuery }}」匹配的服务
          </div>

          <div v-if="flatCommands.length === 0" class="canvas-empty">
            暂无服务，请先在左侧主面板添加分组与项目
          </div>
        </div>

        <!-- 对话框底栏 -->
        <footer class="dialog-footer">
          <div class="footer-left">
            <button
              v-if="initial"
              type="button"
              class="btn-danger-ghost delete-btn"
              @click="emit('delete')"
            >
              <Trash2 class="btn-icon" />
              删除此方案
            </button>
          </div>

          <div class="footer-right">
            <button type="button" class="btn-secondary" @click="emit('cancel')">
              取消
            </button>
            <button
              type="submit"
              class="btn-primary"
              :disabled="checkedCount === 0 || !form.name.trim()"
            >
              保存方案 {{ checkedCount > 0 ? `(${checkedCount} 项)` : '' }}
            </button>
          </div>
        </footer>
      </form>
    </div>
  </div>
</template>

<style scoped>
.scenario-modal {
  width: min(680px, calc(100vw - 32px));
  max-height: min(840px, calc(100vh - 48px));
  display: flex;
  flex-direction: column;
  padding: 16px 20px;
  gap: 12px;
}

/* 顶部首行 */
.dialog-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
}

.topbar-left {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  flex-wrap: wrap;
}

.dialog-title {
  margin: 0;
  font-size: 1.08rem;
  font-weight: 600;
  color: var(--color-foreground);
  flex: none;
}

.scenario-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.tab-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 0.8rem;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  border: 1px solid rgba(236, 239, 244, 0.12);
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-muted-foreground);
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease);
}
.tab-chip:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-foreground);
}
.tab-chip.is-active {
  background: var(--color-accent-soft-bg);
  border-color: var(--color-accent);
  color: var(--color-accent-text);
  font-weight: 500;
}
.chip-add {
  border-style: dashed;
}
.chip-icon {
  width: 11px;
  height: 11px;
}

.dialog-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1;
  min-height: 0;
}

/* 次行:名称 + 搜索过滤整合栏 */
.action-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  flex-wrap: wrap;
}

.name-box {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 200px;
  max-width: 280px;
}

.bar-label {
  font-size: 0.8462rem;
  font-weight: 500;
  color: var(--color-muted-foreground);
  flex: none;
}

.name-input {
  height: 28px;
  font-size: 0.88rem;
  padding: 0 8px;
}

.search-and-tools {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  justify-content: flex-end;
}

.search-wrap {
  position: relative;
  display: flex;
  align-items: center;
  width: 130px;
}

.search-icon {
  position: absolute;
  left: 7px;
  width: 12px;
  height: 12px;
  color: var(--color-muted-foreground);
  pointer-events: none;
}

.search-input {
  width: 100%;
  height: 28px;
  padding: 0 20px 0 24px;
  font-size: 0.8077rem;
  background: var(--input-bg);
  color: var(--color-foreground);
  border: 1px solid var(--input-border);
  border-radius: var(--radius-sm);
  outline: none;
  transition: border-color var(--dur-fast) var(--ease);
}
.search-input:focus {
  border-color: var(--color-accent);
}

.search-clear {
  position: absolute;
  right: 5px;
  background: none;
  border: none;
  color: var(--color-muted-foreground);
  font-size: 13px;
  cursor: pointer;
  padding: 1px 3px;
  line-height: 1;
}

.count-pill {
  font-size: 0.77rem;
  padding: 2px 7px;
  border-radius: var(--radius-sm);
  background: var(--color-accent-soft-bg);
  color: var(--color-accent-text);
  border: 1px solid var(--color-accent-soft-border);
  font-variant-numeric: tabular-nums;
  flex: none;
}

.tool-btns {
  display: flex;
  align-items: center;
  gap: 1px;
  flex: none;
}

.tool-btn {
  font-size: 0.77rem;
  padding: 2px 6px;
  height: 24px;
  border-radius: var(--radius-sm);
}

.tool-sep {
  width: 1px;
  height: 12px;
  background: var(--color-divider);
  margin: 0 3px;
}

/* 服务列表容器:纯净平整画布 */
.tree-canvas {
  flex: 1;
  min-height: 280px;
  max-height: 500px;
  overflow-y: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: rgba(28, 33, 43, 0.45);
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.canvas-empty {
  color: var(--color-muted-foreground);
  font-size: 0.88rem;
  text-align: center;
  padding: var(--space-2xl) var(--space-md);
  font-style: italic;
}

/* 底栏动作 */
.dialog-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 8px;
  border-top: 1px solid var(--color-divider);
}

.footer-left {
  display: flex;
  align-items: center;
}

.footer-right {
  display: flex;
  align-items: center;
  gap: var(--space-md);
}

.btn-danger-ghost {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: transparent;
  color: var(--color-destructive);
  border: 1px solid transparent;
  padding: 4px 10px;
  border-radius: var(--radius-md);
  font-size: 0.8462rem;
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease);
}
.btn-danger-ghost:hover {
  background: var(--color-destructive-soft-bg);
  border-color: var(--color-destructive-soft-border);
}
.btn-icon {
  width: 13px;
  height: 13px;
}
</style>
