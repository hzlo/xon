<script setup>
// 左侧监视面板外壳:递归树(分组可无限嵌套,节点可为分组或项目)。
// 拖拽只在有效目标(分组行)上生效;脱靶一律原地不动,不做"回根级"兜底。
import { provide } from "vue";
import { Folder, Plus } from "lucide-vue-next";
import { store } from "../stores/app.js";
import GroupNode from "./GroupNode.vue";
import ProjectNode from "./ProjectNode.vue";

const emit = defineEmits(["edit", "create"]);

provide("sidebarHandlers", {
  edit: (payload) => emit("edit", payload),
  create: (payload) => emit("create", payload),
});

const isEmpty = () =>
  (store.config.groups?.length ?? 0) + (store.config.projects?.length ?? 0) === 0;
</script>

<template>
  <div class="sidebar-scroll">
    <div v-if="isEmpty()" class="empty-state sidebar-empty">
      <Folder />
      <p>还没有分组和项目</p>
      <p class="hint">分组可以无限嵌套,节点可以随意拖拽;拖到空白处即回到根级</p>
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
      <GroupNode v-for="group in store.config.groups" :key="group.id" :group="group" />
      <ProjectNode
        v-for="project in store.config.projects ?? []"
        :key="project.id"
        :project="project"
      />
    </template>
  </div>
</template>

<style>
@import "../styles/tree.css";
</style>

<style scoped>
.sidebar-scroll {
  height: 100%;
  overflow-y: auto;
  padding: var(--space-md) var(--space-sm) var(--space-2xl);
}

.sidebar-empty {
  padding-top: var(--space-3xl);
}

.empty-actions {
  display: flex;
  gap: var(--space-md);
}
</style>
