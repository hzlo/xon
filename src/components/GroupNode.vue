<script setup>
// 分组节点(递归):分组行(可折叠、可拖拽、可投放)+ 子分组 + 项目。
import { inject, ref } from "vue";
import { Folder, FolderPlus, Pencil, Plus, Trash2 } from "lucide-vue-next";
import { confirmAction, moveNode, removeGroup, store } from "../stores/app.js";
import GroupNode from "./GroupNode.vue";
import ProjectNode from "./ProjectNode.vue";

defineOptions({ name: "GroupNode" });

const props = defineProps({
  group: { type: Object, required: true },
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
  // 阻断冒泡:否则根容器(拖到空白处=回根级)会再次处理,把节点又拖回根级
  e.stopPropagation();
  e.dataTransfer.dropEffect = "move";
  dragOver.value = true;
}

function onDragLeave() {
  dragOver.value = false;
}

function onDrop(e) {
  e.preventDefault();
  e.stopPropagation(); // 同上:分组行已消费,不能再让根容器按"回根级"处理
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
      :class="{ 'drop-target': dragOver, 'is-collapsed': group.collapsed }"
      draggable="true"
      @dragstart="onDragStart"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
      @click="toggle"
    >
      <Folder class="row-icon" />
      <span class="group-name">{{ group.name }}</span>
      <span class="count">{{ (group.groups?.length ?? 0) + (group.projects?.length ?? 0) }}</span>
      <span class="row-actions manage-actions">
        <button class="btn-ghost icon-btn" :aria-label="`在 ${group.name} 中新建子分组`" @click.stop="handlers.create({ kind: 'group', mode: 'create', parentGroup: group })"><Plus /></button>
        <button class="btn-ghost icon-btn" :aria-label="`在 ${group.name} 中新建项目`" @click.stop="handlers.create({ kind: 'project', mode: 'create', parentGroup: group })"><FolderPlus /></button>
        <button class="btn-ghost icon-btn" :aria-label="`重命名分组 ${group.name}`" @click.stop="handlers.edit({ kind: 'group', mode: 'edit', group })"><Pencil /></button>
        <button class="btn-ghost icon-btn is-danger" :aria-label="`删除分组 ${group.name}`" @click.stop="onDelete"><Trash2 /></button>
      </span>
    </div>

    <div v-if="!group.collapsed" class="tree-children">
      <GroupNode v-for="child in group.groups ?? []" :key="child.id" :group="child" />
      <ProjectNode
        v-for="project in group.projects ?? []"
        :key="project.id"
        :project="project"
      />
      <p v-if="(group.groups?.length ?? 0) + (group.projects?.length ?? 0) === 0" class="inline-empty">
        空分组 — 悬停分组行,+ 新建子分组/项目,或直接把别的节点拖进来
      </p>
    </div>
  </section>
</template>

<style scoped>
.group {
  margin-bottom: var(--space-xs);
}
</style>
