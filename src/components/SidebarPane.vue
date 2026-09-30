<script setup>
// 左侧监视面板外壳:根级投放区 + 递归树(分组可无限嵌套,节点可为分组或项目)。
import { provide, ref } from "vue";
import { Folder, Plus } from "lucide-vue-next";
import { moveNode, store } from "../stores/app.js";
import GroupNode from "./GroupNode.vue";
import ProjectNode from "./ProjectNode.vue";

const emit = defineEmits(["edit", "create"]);

provide("sidebarHandlers", {
  edit: (payload) => emit("edit", payload),
  create: (payload) => emit("create", payload),
});

const rootDragOver = ref(false);

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  rootDragOver.value = true;
}

function onDragLeave(e) {
  // 仅当离开整个容器时才取消高亮(避免子元素来回触发闪烁)
  if (!e.currentTarget.contains(e.relatedTarget)) {
    rootDragOver.value = false;
  }
}

function onDrop(e) {
  e.preventDefault();
  rootDragOver.value = false;
  const raw = e.dataTransfer.getData("application/x-xon");
  if (!raw) return;
  try {
    const { type, id } = JSON.parse(raw);
    moveNode(type, id, null);
  } catch {
    /* 无效拖拽数据,忽略 */
  }
}

const isEmpty = () =>
  (store.config.groups?.length ?? 0) + (store.config.projects?.length ?? 0) === 0;
</script>

<template>
  <div
    class="sidebar-scroll"
    :class="{ 'root-drop': rootDragOver }"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <div v-if="isEmpty()" class="empty-state sidebar-empty">
      <Folder />
      <p>还没有分组和项目</p>
      <p class="hint">点击顶部「新建分组」开始整理;分组可以无限嵌套,节点可以随意拖拽</p>
      <button class="btn-secondary" @click="emit('create', { kind: 'group', mode: 'create' })">
        <Plus />新建分组
      </button>
    </div>

    <template v-else>
      <GroupNode v-for="group in store.config.groups" :key="group.id" :group="group" :depth="0" />
      <ProjectNode
        v-for="project in store.config.projects ?? []"
        :key="project.id"
        :project="project"
        :depth="0"
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

.root-drop {
  box-shadow: inset 0 0 0 1px var(--color-accent-soft-border);
  background: var(--color-accent-soft-bg);
}
</style>
