<script setup>
// 左侧监视面板外壳:搜索过滤栏 + 快捷新建(分组/项目)+ 递归分组树 + 底部状态
import { computed, onMounted, onUnmounted, provide, ref } from "vue";
import { Folder, FolderPlus, Package, Plus, Search } from "lucide-vue-next";
import { store } from "../stores/app.js";
import GroupNode from "./GroupNode.vue";
import ProjectNode from "./ProjectNode.vue";

const emit = defineEmits(["edit", "create"]);

provide("sidebarHandlers", {
  edit: (payload) => emit("edit", payload),
  create: (payload) => emit("create", payload),
});

const searchFilter = ref("");
provide("searchFilter", searchFilter);

const addMenuOpen = ref(false);

function closeAddMenu(e) {
  if (!e.target.closest(".add-menu-wrap")) {
    addMenuOpen.value = false;
  }
}

onMounted(() => {
  window.addEventListener("click", closeAddMenu);
});

onUnmounted(() => {
  window.removeEventListener("click", closeAddMenu);
});

const isEmpty = () =>
  (store.config.groups?.length ?? 0) + (store.config.projects?.length ?? 0) === 0;

const totalCommandCount = computed(() => {
  let count = 0;
  for (const p of store.config.projects ?? []) {
    count += p.commands?.length ?? 0;
  }
  const walk = (groups) => {
    for (const g of groups) {
      for (const p of g.projects ?? []) {
        count += p.commands?.length ?? 0;
      }
      walk(g.groups ?? []);
    }
  };
  walk(store.config.groups ?? []);
  return count;
});
</script>

<template>
  <div class="sidebar-container">
    <!-- 顶部过滤与快捷创建栏 (高度与右侧 Tabs 严格统一 35px) -->
    <div class="sidebar-header">
      <div class="search-box">
        <Search class="search-icon" />
        <input
          v-model="searchFilter"
          type="text"
          placeholder="过滤服务与命令…"
          class="search-input"
        />
        <button v-if="searchFilter" class="search-clear" @click="searchFilter = ''">×</button>
      </div>

      <div class="add-menu-wrap">
        <button
          class="btn-ghost icon-btn add-btn"
          title="新建分组或项目"
          aria-label="新建分组或项目"
          @click.stop="addMenuOpen = !addMenuOpen"
        >
          <Plus />
        </button>

        <div v-if="addMenuOpen" class="add-dropdown-menu" @click.stop>
          <button
            class="dropdown-item"
            @click="emit('create', { kind: 'group', mode: 'create' }); addMenuOpen = false;"
          >
            <FolderPlus class="item-icon" />
            <span>新建分组</span>
          </button>
          <button
            class="dropdown-item"
            @click="emit('create', { kind: 'project', mode: 'create' }); addMenuOpen = false;"
          >
            <Package class="item-icon" />
            <span>新建项目</span>
          </button>
        </div>
      </div>
    </div>

    <!-- 树主体滚动区 (恢复完整分组树) -->
    <div class="sidebar-scroll">
      <div v-if="isEmpty()" class="empty-state sidebar-empty">
        <Folder />
        <p>还没有分组和项目</p>
        <p class="hint">点击右上角 + 新建分组或项目开始使用</p>
        <div class="empty-actions">
          <button class="btn-secondary" @click="emit('create', { kind: 'group', mode: 'create' })">
            <Plus />新建分组
          </button>
          <button class="btn-secondary" @click="emit('create', { kind: 'project', mode: 'create' })">
            <Plus />新建项目
          </button>
        </div>
      </div>

      <template v-else>
        <GroupNode v-for="group in store.config.groups ?? []" :key="group.id" :group="group" />
        <ProjectNode
          v-for="project in store.config.projects ?? []"
          :key="project.id"
          :project="project"
        />
      </template>
    </div>

    <!-- 底部状态条 (高度与右侧 LogFooter 严格统一 24px) -->
    <footer class="sidebar-footer">
      <span class="footer-count">{{ totalCommandCount }} 个命令</span>
      <span v-if="store.runningCount.value > 0" class="footer-running">
        <span class="running-dot"></span>
        {{ store.runningCount.value }} 运行中
      </span>
      <span v-else class="footer-idle">就绪</span>
    </footer>
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
}

.sidebar-header {
  height: 35px;
  display: flex;
  align-items: center;
  gap: var(--space-xs);
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
  right: 4px;
  background: none;
  border: none;
  color: var(--color-muted-foreground);
  font-size: 13px;
  cursor: pointer;
  padding: 0 2px;
  line-height: 1;
}

.add-menu-wrap {
  position: relative;
}

.add-btn {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  flex: none;
}

.add-dropdown-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  min-width: 120px;
  background: var(--glass-panel-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  padding: 4px;
  z-index: 100;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.dropdown-item {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: 6px 8px;
  font-size: 0.8462rem;
  color: var(--color-foreground);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  width: 100%;
  text-align: left;
  transition: background var(--dur-fast) var(--ease);
}
.dropdown-item:hover {
  background: var(--overlay-hover);
}

.dropdown-item .item-icon {
  width: 14px;
  height: 14px;
  color: var(--color-muted-foreground);
}

.sidebar-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: var(--space-xs) 0;
}

.sidebar-empty {
  padding-top: var(--space-3xl);
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
