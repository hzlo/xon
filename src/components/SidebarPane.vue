<script setup>
// 左侧监视面板外壳(两级架构:项目 → 命令/服务 + 顶部基础设施底座专区): 搜索过滤 + 状态药丸 + 快捷全局折叠 + 新建项目 + 右键全能菜单 + 底部状态
import { computed, provide, ref } from "vue";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  Edit3,
  Folder,
  MoreHorizontal,
  Play,
  Plus,
  RotateCw,
  Search,
  Server,
  Square,
  Trash2,
  X,
} from "lucide-vue-next";
import {
  cleanCmdSnippet,
  collapseAll,
  commandKey,
  confirmAction,
  duplicateInfraService,
  expandAll,
  formatDuration,
  isTaskCommand,
  notify,
  removeInfraService,
  restartInfraService,
  runningOf,
  startInfraService,
  stopInfraService,
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

// ---- 基础设施展开与管理 ----
const isInfraExpanded = ref(true);

const infraRunningCount = computed(() => {
  let count = 0;
  for (const s of store.config.services ?? []) {
    if (runningOf(commandKey("__infra__", s.id))) count++;
  }
  return count;
});

function isInfraError(service) {
  const key = commandKey("__infra__", service.id);
  const exit = store.lastExitByCommand.get(key);
  return exit && exit.code != null && exit.code !== 0 && !runningOf(key);
}

function infraDuration(service) {
  const p = runningOf(commandKey("__infra__", service.id));
  if (!p) return 0;
  return Math.max(0, store.now.value - p.startedAtMs);
}

function infraStatusText(service) {
  const key = commandKey("__infra__", service.id);
  const p = runningOf(key);
  if (p) return `运行中 (PID ${p.pid})`;
  const exit = store.lastExitByCommand.get(key);
  if (exit && exit.code != null) return `已退出 (码 ${exit.code})`;
  return "未运行";
}

function selectInfra(service) {
  store.selectedKey.value = commandKey("__infra__", service.id);
}

function openInfraMenu(e, service) {
  const key = commandKey("__infra__", service.id);
  const isRunning = runningOf(key) != null;
  const items = [
    isRunning
      ? {
          label: "停止服务",
          icon: Square,
          action: () => stopInfraService(service),
        }
      : {
          label: "启动服务",
          icon: Play,
          action: () => startInfraService(service),
        },
    ...(isRunning
      ? [
          {
            label: "重启服务",
            icon: RotateCw,
            action: () => restartInfraService(service),
          },
        ]
      : []),
    { type: "divider" },
    {
      label: "编辑服务",
      icon: Edit3,
      action: () => emit("edit", { kind: "infra", mode: "edit", service }),
    },
    {
      label: "复制启动命令",
      icon: Copy,
      action: async () => {
        try {
          await navigator.clipboard.writeText(service.cmd);
          notify("已复制启动命令到剪贴板");
        } catch {
          notify("复制失败");
        }
      },
    },
    {
      label: "克隆服务",
      icon: Copy,
      action: () => duplicateInfraService(service),
    },
    { type: "divider" },
    {
      label: "删除服务",
      icon: Trash2,
      danger: true,
      action: () => {
        confirmAction({
          title: "删除基础设施服务",
          message: `确定要删除基础设施服务「${service.name}」吗?`,
          confirmText: "删除",
          danger: true,
          onConfirm: () => removeInfraService(service),
        });
      },
    },
  ];
  openContextMenu(e, items);
}

function onScrollBgContextMenu(e) {
  if (e.target.closest(".project-node") || e.target.closest(".infra-row") || e.target.closest(".infra-header")) {
    return;
  }
  const items = [
    {
      label: "新建项目",
      icon: Plus,
      action: () => emit("create", { kind: "project", mode: "create" }),
    },
    {
      label: "新建基础设施服务",
      icon: Server,
      action: () => emit("create", { kind: "infra", mode: "create" }),
    },
  ];
  openContextMenu(e, items);
}

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

const isEmpty = () => (store.config.projects?.length ?? 0) === 0 && (store.config.services?.length ?? 0) === 0;

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

const filteredInfraServices = computed(() => {
  const list = store.config.services ?? [];
  if (!isFiltering.value) return list;
  const q = searchFilter.value.trim().toLowerCase();
  const st = statusFilter.value;
  return list.filter((s) => {
    const key = commandKey("__infra__", s.id);
    const isRunning = runningOf(key) != null;
    const isErr = isInfraError(s);
    if (st === "running" && !isRunning) return false;
    if (st === "error" && !isErr) return false;
    if (st === "task") return false;
    if (q) {
      return s.name.toLowerCase().includes(q) || s.cmd.toLowerCase().includes(q);
    }
    return true;
  });
});

const hasMatches = computed(() => {
  if (!isFiltering.value) return true;
  if (filteredInfraServices.value.length > 0) return true;
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

    <!-- 树主体滚动区: 纯粹清晰的两级项目树 + 顶部基础设施专区 -->
    <div class="sidebar-scroll" @contextmenu.prevent="onScrollBgContextMenu">
      <!-- 没有任何配置的纯空状态 -->
      <div v-if="isEmpty()" class="empty-state sidebar-empty">
        <Folder />
        <p>还没有项目或服务</p>
        <p class="hint">点击新建项目或基础设施服务开始使用</p>
        <div class="empty-actions">
          <button class="btn-secondary" @click="emit('create', { kind: 'project', mode: 'create' })">
            <Plus />新建项目
          </button>
          <button class="btn-secondary" @click="emit('create', { kind: 'infra', mode: 'create' })">
            <Server />新建基础设施
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

    <!-- 基础设施 / 运行底座专区 (置底独立区) -->
    <div v-if="!isEmpty()" class="infra-section">
      <div class="infra-header" @click="isInfraExpanded = !isInfraExpanded">
        <div class="infra-header-left">
          <span class="tree-arrow">
            <ChevronDown v-if="isInfraExpanded" class="chevron" />
            <ChevronRight v-else class="chevron" />
          </span>
          <Server class="row-icon" />
          <span class="infra-header-title">基础设施</span>
          <span class="infra-header-count">({{ store.config.services?.length ?? 0 }})</span>
          <span v-if="infraRunningCount > 0" class="infra-running-tag">
            <span class="tag-dot"></span>
            {{ infraRunningCount }}
          </span>
        </div>
        <div class="infra-header-actions" @click.stop>
          <button
            class="btn-ghost icon-btn add-btn"
            title="新建基础设施服务 (如 WSL / Docker / Redis)"
            @click="emit('create', { kind: 'infra', mode: 'create' })"
          >
            <Plus />
          </button>
        </div>
      </div>

      <div v-show="isInfraExpanded" class="infra-list">
        <div
          v-for="service in filteredInfraServices"
          :key="service.id"
          class="infra-row"
          :class="{
            'is-selected': store.selectedKey.value === commandKey('__infra__', service.id),
            'is-running': runningOf(commandKey('__infra__', service.id)) != null,
          }"
          @click="selectInfra(service)"
          @contextmenu.prevent.stop="openInfraMenu($event, service)"
        >
          <span class="status-dot">
            <span
              class="dot-inner"
              :class="{
                running: runningOf(commandKey('__infra__', service.id)) != null,
                error: isInfraError(service),
              }"
              :title="infraStatusText(service)"
            ></span>
          </span>

          <span class="infra-name" :title="service.name">{{ service.name }}</span>

          <span class="infra-cmd" :title="service.cmd">{{ cleanCmdSnippet(service.cmd) }}</span>

          <span v-if="runningOf(commandKey('__infra__', service.id))" class="infra-uptime">
            {{ formatDuration(infraDuration(service)) }}
          </span>

          <span class="infra-actions" @click.stop>
            <button
              v-if="!runningOf(commandKey('__infra__', service.id))"
              class="btn-ghost icon-btn is-accent"
              title="启动基础设施服务"
              @click.stop="startInfraService(service)"
            >
              <Play />
            </button>
            <template v-else>
              <button
                class="btn-ghost icon-btn is-danger"
                :title="service.stopCmd ? `停止 (将执行: ${service.stopCmd})` : '停止'"
                @click.stop="stopInfraService(service)"
              >
                <Square />
              </button>
              <button
                class="btn-ghost icon-btn"
                title="重启"
                @click.stop="restartInfraService(service)"
              >
                <RotateCw />
              </button>
            </template>
            <button
              class="btn-ghost icon-btn"
              title="更多操作"
              @click.stop="openInfraMenu($event, service)"
            >
              <MoreHorizontal />
            </button>
          </span>
        </div>

        <div v-if="(store.config.services ?? []).length === 0" class="inline-empty">
          暂无基础设施服务, 点击右上角 + 添加
        </div>
      </div>
    </div>

    <!-- 底部状态条 -->
    <footer class="sidebar-footer">
      <span class="footer-count">
        <template v-if="(store.config.services ?? []).length > 0">
          {{ store.config.services.length }} 设施 · 
        </template>
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
