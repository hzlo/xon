<script setup>
// 分组节点(递归):分组行(可折叠、可拖拽、可投放)+ 子分组 + 项目。
import { inject, ref } from "vue";
import { ChevronDown, FolderPlus, Pencil, Plus, Trash2 } from "lucide-vue-next";
import { confirmAction, moveNode, removeGroup, store } from "../stores/app.js";
import GroupNode from "./GroupNode.vue";
import ProjectNode from "./ProjectNode.vue";

defineOptions({ name: "GroupNode" });

const props = defineProps({
  group: { type: Object, required: true },
  depth: { type: Number, default: 0 },
});

const handlers = inject("sidebarHandlers");
const dragOver = ref(false);

function toggle() {
  props.group.collapsed = !props.group.collapsed;
}

async function onDelete() {
  if (await confirmAction(`删除分组「${props.group.name}」?\n其直属子分组与项目将上移到上一级。`, { title: "删除分组", danger: true })) {
    removeGroup(props.group);
  }
}

function onDragStart(e) {
  e.dataTransfer.setData("application/x-xon", JSON.stringify({ type: "group", id: props.group.id }));
  e.dataTransfer.effectAllowed = "move";
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  dragOver.value = true;
}

function onDragLeave() {
  dragOver.value = false;
}

function onDrop(e) {
  e.preventDefault();
  dragOver.value = false;
  const raw = e.dataTransfer.getData("application/x-xon");
  if (!raw) return;
  try {
    const { type, id } = JSON.parse(raw);
    moveNode(type, id, props.group.id);
  } catch {
    /* 无效拖拽数据,忽略 */
  }
}
</script>

<template>
  <section class="group">
    <div
      class="row group-row"
      :class="{ 'drop-target': dragOver }"
      draggable="true"
      @dragstart="onDragStart"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <button
        class="btn-ghost icon-btn group-toggle"
        :aria-expanded="!group.collapsed"
        :aria-label="`${group.collapsed ? '展开' : '折叠'}分组 ${group.name}`"
        @click="toggle"
      >
        <ChevronDown class="chevron" :class="{ collapsed: group.collapsed }" />
      </button>
      <span
        class="group-name"
        role="button"
        tabindex="0"
        @click="toggle"
        @keydown.enter.prevent="toggle"
      >{{ group.name }}</span>
      <span class="count">{{ (group.groups?.length ?? 0) + (group.projects?.length ?? 0) }}</span>
      <span class="row-actions manage-actions">
        <button class="btn-ghost icon-btn" :aria-label="`在 ${group.name} 中新建子分组`" @click="handlers.create({ kind: 'group', mode: 'create', parentGroup: group })"><Plus /></button>
        <button class="btn-ghost icon-btn" :aria-label="`在 ${group.name} 中新建项目`" @click="handlers.create({ kind: 'project', mode: 'create', parentGroup: group })"><FolderPlus /></button>
        <button class="btn-ghost icon-btn" :aria-label="`重命名分组 ${group.name}`" @click="handlers.edit({ kind: 'group', mode: 'edit', group })"><Pencil /></button>
        <button class="btn-ghost icon-btn is-danger" :aria-label="`删除分组 ${group.name}`" @click="onDelete"><Trash2 /></button>
      </span>
    </div>

    <template v-if="!group.collapsed">
      <GroupNode v-for="child in group.groups ?? []" :key="child.id" :group="child" :depth="depth + 1" />
      <ProjectNode
        v-for="project in group.projects ?? []"
        :key="project.id"
        :project="project"
        :depth="depth + 1"
      />
      <p v-if="(group.groups?.length ?? 0) + (group.projects?.length ?? 0) === 0" class="inline-empty">
        空分组 — 悬停分组行,+ 新建子分组/项目,或直接把别的节点拖进来
      </p>
    </template>
  </section>
</template>

<style scoped>
.group {
  margin-bottom: var(--space-sm);
}
.group-row {
  padding-left: calc(var(--space-md) * (1 + v-bind("depth") * 0.9));
}
</style>
