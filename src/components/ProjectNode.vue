<script setup>
// 项目节点:项目行(可拖拽移动)+ 其命令行(启动/停止/重启/编辑/删除)。
import { inject } from "vue";
import {
  ChevronDown,
  CodeXml,
  Package,
  FolderOpen,
  Pencil,
  Play,
  Plus,
  RotateCw,
  Square,
  SquareTerminal,
  Terminal,
  Trash2,
} from "lucide-vue-next";
import {
  commandKey,
  confirmAction,
  notify,
  removeCommand,
  removeProject,
  restartCommand,
  runningOf,
  startCommand,
  stopPid,
  store,
} from "../stores/app.js";
import { openDirInExplorer, openTerminal, openVscode } from "../api.js";
import StatusBadge from "./StatusBadge.vue";

defineOptions({ name: "ProjectNode" });

const props = defineProps({
  project: { type: Object, required: true },
});

const handlers = inject("sidebarHandlers");

function toggle() {
  props.project.collapsed = !props.project.collapsed;
}

function keyOf(command) {
  return commandKey(props.project.id, command.id);
}

function statusOf(command) {
  const key = keyOf(command);
  if (runningOf(key)) return { state: "running", label: "运行中" };
  const exit = store.lastExitByCommand.get(key);
  if (!exit) return { state: "stopped", label: "待启动" };
  if (exit.code != null && exit.code !== 0) return { state: "error", label: `退出 ${exit.code}` };
  return { state: "stopped", label: "已停止" };
}

function isSelected(command) {
  return store.selectedKey.value === keyOf(command);
}

function select(command) {
  store.selectedKey.value = keyOf(props.project.id, command.id);
}

async function onDelete() {
  if (await confirmAction(`删除项目「${props.project.name}」?\n其下所有命令将一并删除。`, { title: "删除项目", danger: true })) {
    if (props.project.commands.some((c) => isSelected(c))) store.selectedKey.value = null;
    removeProject(props.project);
  }
}

async function onDeleteCommand(command) {
  if (await confirmAction(`删除命令「${command.name}」?`, { title: "删除命令", danger: true })) {
    removeCommand(props.project, command);
  }
}

async function openIn(fn) {
  const dir = (props.project.dir || "").trim();
  if (!dir) {
    notify("该项目未配置目录,请先编辑项目填写目录");
    return;
  }
  try {
    await fn(dir);
  } catch (e) {
    notify(String(e));
  }
}

function onDragStart(e) {
  e.dataTransfer.setData("application/x-xon", JSON.stringify({ type: "project", id: props.project.id }));
  e.dataTransfer.effectAllowed = "move";
}
</script>

<template>
  <div class="project">
    <div class="row project-row" draggable="true" @dragstart="onDragStart">
      <button
        class="btn-ghost icon-btn group-toggle"
        :aria-expanded="!project.collapsed"
        :aria-label="`${project.collapsed ? '展开' : '折叠'}项目 ${project.name}`"
        @click="toggle"
      >
        <ChevronDown class="chevron" :class="{ collapsed: project.collapsed }" />
      </button>
      <Package class="row-icon" />
      <span
        class="project-name"
        role="button"
        tabindex="0"
        :title="project.dir"
        @click="toggle"
        @keydown.enter.prevent="toggle"
      >{{ project.name }}</span>
      <span class="row-actions manage-actions">
        <button class="btn-ghost icon-btn" aria-label="打开目录" title="打开目录" @click="openIn(openDirInExplorer)"><FolderOpen /></button>
        <button class="btn-ghost icon-btn" aria-label="打开终端" title="打开终端" @click="openIn(openTerminal)"><SquareTerminal /></button>
        <button class="btn-ghost icon-btn" aria-label="VSCode 打开" title="VSCode 打开" @click="openIn(openVscode)"><CodeXml /></button>
        <button class="btn-ghost icon-btn" :aria-label="`在 ${project.name} 中新建命令`" @click="handlers.create({ kind: 'command', mode: 'create', project })"><Plus /></button>
        <button class="btn-ghost icon-btn" :aria-label="`编辑项目 ${project.name}`" @click="handlers.edit({ kind: 'project', mode: 'edit', project })"><Pencil /></button>
        <button class="btn-ghost icon-btn is-danger" :aria-label="`删除项目 ${project.name}`" @click="onDelete"><Trash2 /></button>
      </span>
    </div>

    <div v-if="!project.collapsed" class="tree-children">
      <div
        v-for="command in project.commands"
        :key="command.id"
        class="row cmd-row"
        :class="{ 'is-active': isSelected(command) }"
        role="button"
        tabindex="0"
        :aria-selected="isSelected(command)"
        @click="select(command)"
        @keydown.enter.prevent="select(command)"
        @keydown.space.prevent="select(command)"
      >
      <Terminal class="row-icon" />
      <span class="cmd-name">{{ command.name }}</span>
      <span class="cmd-snippet" :title="command.cmd">{{ command.cmd }}</span>
      <StatusBadge :state="statusOf(command).state" :label="statusOf(command).label" />
      <span class="row-actions primary-actions">
        <button
          v-if="!runningOf(keyOf(command))"
          class="btn-ghost icon-btn is-accent"
          :aria-label="`启动 ${command.name}`"
          @click.stop="startCommand(project, command)"
        >
          <Play />
        </button>
        <template v-else>
          <button
            class="btn-ghost icon-btn is-danger"
            :aria-label="`停止 ${command.name}`"
            @click.stop="stopPid(runningOf(keyOf(command)).pid)"
          >
            <Square />
          </button>
          <button
            class="btn-ghost icon-btn"
            :aria-label="`重启 ${command.name}`"
            @click.stop="restartCommand(project, command)"
          >
            <RotateCw />
          </button>
        </template>
      </span>
      <span class="row-actions manage-actions">
        <button class="btn-ghost icon-btn" :aria-label="`编辑命令 ${command.name}`" @click.stop="handlers.edit({ kind: 'command', mode: 'edit', project, command })"><Pencil /></button>
        <button class="btn-ghost icon-btn is-danger" :aria-label="`删除命令 ${command.name}`" @click.stop="onDeleteCommand(command)"><Trash2 /></button>
      </span>
    </div>

      <p v-if="project.commands.length === 0" class="inline-empty">此项目还没有命令 — 悬停项目行,点 + 新建</p>
    </div>
  </div>
</template>
