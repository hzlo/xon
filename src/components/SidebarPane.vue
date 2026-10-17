<script setup>
// 左侧监视面板外壳(两级架构:项目 → 命令/服务): 搜索过滤 + 状态药丸 + 快捷全局折叠 + 新建项目 + 右键全能菜单 + 底部状态
import { computed, provide, ref } from "vue";
import {
  ChevronsDownUp,
  ChevronsUpDown,
  Folder,
  Plus,
  Search,
  X,
} from "lucide-vue-next";
import {
  collapseAll,
  expandAll,
  isTaskCommand,
  runningOf,
  store,
} from "../stores/app.js";
import ContextMenu from "./ContextMenu.vue";
import ProjectNode from "./ProjectNode.vue";

const emit = defineEmits(["edit", "create"]);

provide("sidebarHandlers", {
  edit: (payload) => emit("edit", payload),
  create: (payload) => emit("create", payload),
});

// ---- 全局右键上下文菜单 ----
const contextMenu = ref({ visible: false, x: 0, y: 0, items: [] });
function openContextMenu(e, items) {
  contextMenu.value = {
    visible: true,
    x: e.clientX,
    y: e.clientY,
    items,
  };
}
provide("openContextMenu", openContextMenu);

// ---- 搜索与状态过滤联动 ----
const searchFilter = ref("");
const statusFilter = ref("all"); // 'all' | 'running' | 'error' | 'task'

provide("treeFilter", {
  search: searchFilter,
  status: statusFilter,
});

function clearFilter() {
  searchFilter.value = "";
  statusFilter.value = "all";
}

// ---- 全局展开 / 折叠 ----
const isAllCollapsed = ref(false);
function toggleExpandCollapseAll() {
  if (isAllCollapsed.value) {
    expandAll();
    isAllCollapsed.value = false;
  } else {
    collapseAll();
    isAllCollapsed.value = true;
  }
}

const isEmpty = () => (store.config.projects?.length ?? 0) === 0;

const totalCommandCount = computed(() => {
  let count = 0;
  for (const p of store.config.projects ?? []) {
    count += p.commands?.length ?? 0;
  }
  return count;
});

const totalErrorCount = computed(() => {
  let count = 0;
  for (const [key, exit] of store.lastExitByCommand.entries()) {
    if (exit && exit.code != null && exit.code !== 0 && !runningOf(key)) {
      count++;
    }
  }
  return count;
});

const totalTaskCount = computed(() => {
  let count = 0;
  for (const p of store.config.projects ?? []) {
    for (const c of p.commands ?? []) {
      if (isTaskCommand(c)) count++;
    }
  }
  return count;
});

function matchesCmd(project, command, q, st) {
  const isRunning = runningOf(`${project.id}/${command.id}`) != null;
  const isTask = isTaskCommand(command);
  const exit = store.lastExitByCommand.get(`${project.id}/${command.id}`);
  const isErr = exit && exit.code != null && exit.code !== 0 && !isRunning;

  if (st === "running" && !isRunning) return false;
  if (st === "error" && !isErr) return false;
  if (st === "task" && !isTask) return false;

  if (q) {
    const matchProject = project.name?.toLowerCase().includes(q);
    const matchName = command.name?.toLowerCase().includes(q);
    const matchCmd = command.cmd?.toLowerCase().includes(q);
    return matchProject || matchName || matchCmd;
  }
  return true;
}

const isFiltering = computed(() => !!searchFilter.value.trim() || statusFilter.value !== "all");

const hasMatches = computed(() => {
  if (!isFiltering.value) return true;
  const q = searchFilter.value.trim().toLowerCase();
  const st = statusFilter.value;

  for (const p of store.config.projects ?? []) {
    for (const c of p.commands ?? []) {
      if (matchesCmd(p, c, q, st)) return true;
    }
    if (st === "all" && q && p.name?.toLowerCase().includes(q)) return true;
  }
  return false;
});
</script>

<template>
  <div class="sidebar-container">
    <!-- 顶部过滤与快捷创建栏 -->
    <div class="sidebar-header">
      <div class="search-box">
        <Search class="search-icon" />
        <input
          v-model="searchFilter"
          type="text"
          placeholder="过滤服务、命令与端口…"
          class="search-input"
          @keydown.esc="searchFilter = ''"
        />
        <button v-if="searchFilter" class="search-clear" title="清空搜索" @click="searchFilter = ''">
          <X class="clear-icon" />
        </button>
      </div>

      <!-- 全部展开/折叠按钮 -->
      <button
        class="btn-ghost icon-btn toggle-all-btn"
        :title="isAllCollapsed ? '全部展开' : '全部折叠'"
        @click="toggleExpandCollapseAll"
      >
        <ChevronsDownUp v-if="!isAllCollapsed" />
        <ChevronsUpDown v-else />
      </button>

      <!-- 新建项目按钮(直接打开新建项目,无需多级嵌套) -->
      <button
        class="btn-ghost icon-btn add-btn"
        title="新建项目"
        aria-label="新建项目"
        @click="emit('create', { kind: 'project', mode: 'create' })"
      >
        <Plus />
      </button>
    </div>

    <!-- 快捷状态过滤药丸条 -->
    <div
      v-if="store.runningCount.value > 0 || totalErrorCount > 0 || isFiltering"
      class="filter-pills-bar"
    >
      <button
        class="filter-pill"
        :class="{ active: statusFilter === 'all' }"
        @click="statusFilter = 'all'"
      >
        全部
      </button>
      <button
        v-if="store.runningCount.value > 0"
        class="filter-pill is-running"
        :class="{ active: statusFilter === 'running' }"
        @click="statusFilter = statusFilter === 'running' ? 'all' : 'running'"
      >
        <span class="pill-dot"></span>
        运行中 ({{ store.runningCount.value }})
      </button>
      <button
        v-if="totalErrorCount > 0"
        class="filter-pill is-error"
        :class="{ active: statusFilter === 'error' }"
        @click="statusFilter = statusFilter === 'error' ? 'all' : 'error'"
      >
        异常 ({{ totalErrorCount }})
      </button>
      <button
        v-if="totalTaskCount > 0"
        class="filter-pill"
        :class="{ active: statusFilter === 'task' }"
        @click="statusFilter = statusFilter === 'task' ? 'all' : 'task'"
      >
        任务 ({{ totalTaskCount }})
      </button>
      <button v-if="isFiltering" class="filter-reset-btn" title="重置筛选" @click="clearFilter">
        重置
      </button>
    </div>

    <!-- 树主体滚动区: 纯粹清晰的两级项目树 -->
    <div class="sidebar-scroll">
      <!-- 没有任何配置的纯空状态 -->
      <div v-if="isEmpty()" class="empty-state sidebar-empty">
        <Folder />
        <p>还没有项目</p>
        <p class="hint">点击右上角 + 新建项目开始使用</p>
        <div class="empty-actions">
          <button class="btn-secondary" @click="emit('create', { kind: 'project', mode: 'create' })">
            <Plus />新建项目
          </button>
        </div>
      </div>

      <!-- 搜索过滤无结果的空状态 -->
      <div v-else-if="isFiltering && !hasMatches" class="sidebar-filter-empty">
        <p>未找到匹配的服务或命令</p>
        <button class="btn-secondary btn-sm" @click="clearFilter">清除过滤条件</button>
      </div>

      <!-- 正常两级项目列表 -->
      <div v-else class="project-tree-list">
        <ProjectNode
          v-for="(project, idx) in store.config.projects ?? []"
          :key="project.id"
          :project="project"
          :index="idx"
        />
      </div>
    </div>

    <!-- 底部状态条 -->
    <footer class="sidebar-footer">
      <span class="footer-count">
        {{ store.config.projects?.length ?? 0 }} 项目 · {{ totalCommandCount }} 命令
        <span v-if="totalTaskCount > 0" class="sub-count">({{ totalTaskCount }} 任务)</span>
      </span>
      <span v-if="store.runningCount.value > 0" class="footer-running">
        <span class="running-dot"></span>
        {{ store.runningCount.value }} 运行中
      </span>
      <span v-else class="footer-idle">就绪</span>
    </footer>

    <!-- 全局悬浮右键菜单 -->
    <ContextMenu
      v-if="contextMenu.visible"
      :x="contextMenu.x"
      :y="contextMenu.y"
      :items="contextMenu.items"
      @close="contextMenu.visible = false"
    />
  </div>
</template>

<style>
@import "../styles/tree.css";
</style>

<style scoped>
.sidebar-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-card);
  user-select: none;
  position: relative;
}

.sidebar-header {
  height: 35px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 var(--space-sm);
  background: var(--color-card);
  border-bottom: 1px solid var(--color-divider);
  flex: none;
  box-sizing: border-box;
}

.search-box {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
}

.search-icon {
  position: absolute;
  left: 6px;
  width: 12px;
  height: 12px;
  color: var(--color-muted-foreground);
  pointer-events: none;
}

.search-input {
  width: 100%;
  height: 24px;
  padding: 0 20px 0 22px;
  font-size: 0.8462rem;
  background: var(--input-bg);
  border: 1px solid var(--input-border);
  border-radius: var(--radius-sm);
  color: var(--color-foreground);
  outline: none;
  transition: border-color var(--dur-fast) var(--ease);
}
.search-input:focus {
  border-color: var(--color-accent);
}

.search-clear {
  position: absolute;
  right: 3px;
  background: none;
  border: none;
  color: var(--color-muted-foreground);
  cursor: pointer;
  padding: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.search-clear:hover {
  color: var(--color-foreground);
}
.clear-icon {
  width: 11px;
  height: 11px;
}

.toggle-all-btn,
.add-btn {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  flex: none;
}

/* 过滤状态药丸栏 */
.filter-pills-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px var(--space-sm);
  background: var(--input-bg);
  border-bottom: 1px solid var(--color-divider);
  flex: none;
  overflow-x: auto;
}
.filter-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 7px;
  height: 19px;
  border-radius: 999px;
  border: 1px solid transparent;
  background: transparent;
  font-size: 0.73rem;
  color: var(--color-muted-foreground);
  cursor: pointer;
  white-space: nowrap;
  transition: all var(--dur-fast) var(--ease);
}
.filter-pill:hover {
  background: var(--overlay-hover);
  color: var(--color-foreground);
}
.filter-pill.active {
  background: var(--overlay-selected);
  color: var(--color-accent);
  border-color: var(--color-accent-soft-border);
  font-weight: 500;
}
.filter-pill.is-running .pill-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--color-success);
}
.filter-pill.is-error {
  color: var(--color-destructive);
}
.filter-reset-btn {
  margin-left: auto;
  border: none;
  background: transparent;
  font-size: 0.72rem;
  color: var(--color-muted-foreground);
  cursor: pointer;
  padding: 0 4px;
}
.filter-reset-btn:hover {
  color: var(--color-foreground);
  text-decoration: underline;
}

.sidebar-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: var(--space-xs) 0;
}

.project-tree-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.sidebar-empty {
  padding-top: var(--space-3xl);
}

.sidebar-filter-empty {
  padding: var(--space-xl) var(--space-md);
  text-align: center;
  color: var(--color-muted-foreground);
  font-size: 0.85rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-sm);
}

.empty-actions {
  display: flex;
  gap: var(--space-md);
}

.sidebar-footer {
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-sm);
  background: var(--color-card);
  border-top: 1px solid var(--color-divider);
  font-size: 0.7692rem;
  color: var(--color-muted-foreground);
  flex: none;
  box-sizing: border-box;
}

.footer-count .sub-count {
  opacity: 0.65;
  font-size: 0.72rem;
  margin-left: 2px;
}

.footer-running {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--color-success);
}

.running-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--color-success);
}
</style>
