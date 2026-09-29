<script setup>
// 左侧监视面板:分组(可折叠)→ 项目 → 命令行。
// 命令行承载选择、状态徽章与行内 启动/停止/重启 操作。
import {
  ChevronDown,
  CodeXml,
  Folder,
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
import { computed } from "vue";
import {
  commandKey,
  removeCommand,
  removeGroup,
  removeProject,
  restartCommand,
  runningOf,
  startCommand,
  stopPid,
  store,
} from "../stores/app.js";
import { openDirInExplorer, openTerminal, openVscode } from "../api.js";
import StatusBadge from "./StatusBadge.vue";

const emit = defineEmits(["edit", "create"]);

function keyOf(project, command) {
  return commandKey(project.id, command.id);
}

function statusOf(project, command) {
  const key = keyOf(project, command);
  const proc = runningOf(key);
  if (proc) return { state: "running", label: "运行中" };
  const exit = store.lastExitByCommand.get(key);
  if (!exit) return { state: "stopped", label: "待启动" };
  if (exit.code != null && exit.code !== 0) {
    return { state: "error", label: `退出 ${exit.code}` };
  }
  return { state: "stopped", label: "已停止" };
}

function isSelected(project, command) {
  return store.selectedKey.value === keyOf(project, command);
}

function select(project, command) {
  store.selectedKey.value = keyOf(project, command);
}

function toggleGroup(group) {
  group.collapsed = !group.collapsed;
}

const hasGroups = computed(() => store.config.groups.length > 0);

function onDeleteGroup(group) {
  if (window.confirm(`删除分组「${group.name}」及其下所有项目与命令?`)) {
    removeGroup(group);
  }
}

function onDeleteProject(project) {
  if (window.confirm(`删除项目「${project.name}」及其下所有命令?`)) {
    removeProject(project);
  }
}

function onDeleteCommand(project, command) {
  if (window.confirm(`删除命令「${command.name}」?`)) {
    removeCommand(project, command);
  }
}

/* 快速打开目录 / 终端 / VSCode(M3) */
function requireDir(project) {
  const dir = (project.dir || "").trim();
  if (!dir) {
    window.alert("该项目未配置目录,请先编辑项目填写目录");
    return null;
  }
  return dir;
}

async function onOpenDir(project) {
  const dir = requireDir(project);
  if (!dir) return;
  try {
    await openDirInExplorer(dir);
  } catch (e) {
    window.alert(String(e));
  }
}

async function onOpenTerminal(project) {
  const dir = requireDir(project);
  if (!dir) return;
  try {
    await openTerminal(dir);
  } catch (e) {
    window.alert(String(e));
  }
}

async function onOpenVscode(project) {
  const dir = requireDir(project);
  if (!dir) return;
  try {
    await openVscode(dir);
  } catch (e) {
    window.alert(String(e));
  }
}
</script>

<template>
  <div class="sidebar-scroll">
    <div v-if="!hasGroups" class="empty-state sidebar-empty">
      <Folder />
      <p>还没有分组</p>
      <p class="hint">点击顶部「新建分组」,把项目目录按场景归组管理</p>
      <button class="btn-secondary" @click="emit('create', { kind: 'group' })">
        <Plus />新建分组
      </button>
    </div>

    <section v-for="group in store.config.groups" :key="group.id" class="group">
      <div class="row group-row">
        <button
          class="btn-ghost icon-btn group-toggle"
          :aria-expanded="!group.collapsed"
          :aria-label="`${group.collapsed ? '展开' : '折叠'}分组 ${group.name}`"
          @click="toggleGroup(group)"
        >
          <ChevronDown class="chevron" :class="{ collapsed: group.collapsed }" />
        </button>
        <span
          class="group-name"
          role="button"
          tabindex="0"
          @click="toggleGroup(group)"
          @keydown.enter.prevent="toggleGroup(group)"
        >{{ group.name }}</span>
        <span class="count">{{ group.projects.length }}</span>
        <span class="row-actions manage-actions">
          <button class="btn-ghost icon-btn" :aria-label="`在 ${group.name} 中新建项目`" @click="emit('create', { kind: 'project', group })"><Plus /></button>
          <button class="btn-ghost icon-btn" :aria-label="`重命名分组 ${group.name}`" @click="emit('edit', { kind: 'group', group })"><Pencil /></button>
          <button class="btn-ghost icon-btn is-danger" :aria-label="`删除分组 ${group.name}`" @click="onDeleteGroup(group)"><Trash2 /></button>
        </span>
      </div>

      <template v-if="!group.collapsed">
        <div v-for="project in group.projects" :key="project.id" class="project">
          <div class="row project-row">
            <Folder class="row-icon" />
            <span class="project-name" :title="project.dir">{{ project.name }}</span>
            <span class="row-actions manage-actions">
              <button class="btn-ghost icon-btn" :aria-label="`在资源管理器打开 ${project.name}`" title="打开目录" @click="onOpenDir(project)"><FolderOpen /></button>
              <button class="btn-ghost icon-btn" :aria-label="`在终端打开 ${project.name}`" title="打开终端" @click="onOpenTerminal(project)"><SquareTerminal /></button>
              <button class="btn-ghost icon-btn" :aria-label="`用 VSCode 打开 ${project.name}`" title="VSCode 打开" @click="onOpenVscode(project)"><CodeXml /></button>
              <button class="btn-ghost icon-btn" :aria-label="`在 ${project.name} 中新建命令`" @click="emit('create', { kind: 'command', group, project })"><Plus /></button>
              <button class="btn-ghost icon-btn" :aria-label="`编辑项目 ${project.name}`" @click="emit('edit', { kind: 'project', group, project })"><Pencil /></button>
              <button class="btn-ghost icon-btn is-danger" :aria-label="`删除项目 ${project.name}`" @click="onDeleteProject(project)"><Trash2 /></button>
            </span>
          </div>

          <div
            v-for="command in project.commands"
            :key="command.id"
            class="row cmd-row"
            :class="{ 'is-active': isSelected(project, command) }"
            role="button"
            tabindex="0"
            :aria-selected="isSelected(project, command)"
            @click="select(project, command)"
            @keydown.enter.prevent="select(project, command)"
            @keydown.space.prevent="select(project, command)"
          >
            <Terminal class="row-icon" />
            <span class="cmd-name">{{ command.name }}</span>
            <span class="cmd-snippet" :title="command.cmd">{{ command.cmd }}</span>
            <StatusBadge :state="statusOf(project, command).state" :label="statusOf(project, command).label" />
            <span class="row-actions primary-actions">
              <button
                v-if="!runningOf(keyOf(project, command))"
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
                  @click.stop="stopPid(runningOf(keyOf(project, command)).pid)"
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
              <button class="btn-ghost icon-btn" :aria-label="`编辑命令 ${command.name}`" @click.stop="emit('edit', { kind: 'command', group, project, command })"><Pencil /></button>
              <button class="btn-ghost icon-btn is-danger" :aria-label="`删除命令 ${command.name}`" @click.stop="onDeleteCommand(project, command)"><Trash2 /></button>
            </span>
          </div>

          <p v-if="project.commands.length === 0" class="inline-empty">此项目还没有命令 — 悬停项目行,点 + 新建</p>
        </div>

        <p v-if="group.projects.length === 0" class="inline-empty">此分组还没有项目 — 悬停分组行,点 + 新建</p>
      </template>
    </section>
  </div>
</template>

<style scoped>
.sidebar-scroll {
  height: 100%;
  overflow-y: auto;
  padding: var(--space-md) var(--space-sm) var(--space-2xl);
}

.sidebar-empty {
  padding-top: var(--space-3xl);
}

.group {
  margin-bottom: var(--space-sm);
}

.group-row,
.project-row,
.cmd-row {
  width: 100%;
}

.group-name {
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-toggle {
  flex: none;
}
.chevron {
  transition: transform var(--dur-normal) var(--ease);
}
.chevron.collapsed {
  transform: rotate(-90deg);
}

.count {
  font-size: 11px;
  color: var(--color-muted-foreground);
  font-family: var(--font-mono);
}

.project {
  margin-left: var(--space-lg);
  border-left: 1px solid var(--color-muted);
  padding-left: var(--space-xs);
}

.row-icon {
  width: 13px;
  height: 13px;
  flex: none;
  color: var(--color-muted-foreground);
}

.project-name {
  font-size: 12px;
  color: var(--color-muted-foreground);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cmd-row {
  padding-left: var(--space-lg);
}
.cmd-name {
  font-size: 13px;
  flex: none;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cmd-snippet {
  flex: 1;
  min-width: 0;
  font: 400 11px/1.4 var(--font-mono);
  color: var(--color-muted-foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-actions {
  display: inline-flex;
  align-items: center;
  gap: 0;
  flex: none;
}
.manage-actions {
  visibility: hidden;
}
.row:hover .manage-actions,
.row:focus-within .manage-actions {
  visibility: visible;
}

.inline-empty {
  margin: var(--space-xs) 0 var(--space-md) var(--space-lg);
  padding: var(--space-sm) var(--space-md);
  font-size: 12px;
  color: var(--color-muted-foreground);
  opacity: 0.75;
  border: 1px dashed var(--color-muted);
  border-radius: var(--radius-md);
}
</style>
