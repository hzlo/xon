<script setup>
// 项目节点(两级扁平模型): 项目行(折叠、冒泡状态、拖拽排序、全能右键) + 命令行(常驻服务/任务区分、命令清洗、端口直达、拖拽排序、全能右键)
import { computed, inject, ref } from "vue";
import {
  ChevronDown,
  Copy,
  ExternalLink,
  FolderOpen,
  MoreHorizontal,
  Package,
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
  cleanCmdSnippet,
  clearLog,
  commandKey,
  confirmAction,
  copyToClipboard,
  duplicateCommand,
  formatDuration,
  isTaskCommand,
  notify,
  persist,
  removeCommand,
  removeProject,
  reorderCommands,
  reorderProjects,
  restartCommand,
  runningOf,
  startCommand,
  startProject,
  stopPid,
  stopProject,
  store,
} from "../stores/app.js";
import { openBrowserUrl, openDirInExplorer, openTerminal } from "../api.js";

defineOptions({ name: "ProjectNode" });

const props = defineProps({
  project: { type: Object, required: true },
  index: { type: Number, default: 0 },
});

const handlers = inject("sidebarHandlers");
const openContextMenu = inject("openContextMenu");
const treeFilter = inject("treeFilter", null);

const isProjectDragOver = ref(false);
const cmdDragOverIdx = ref(-1);

function toggle() {
  props.project.collapsed = !props.project.collapsed;
  persist();
}

function keyOf(command) {
  return commandKey(props.project.id, command.id);
}

function isSelected(command) {
  return store.selectedKey.value === keyOf(command);
}

function select(command) {
  store.selectedKey.value = keyOf(command);
}

function portNumberOf(cmd) {
  if (!cmd) return "";
  const m = cmd.match(/(?:--port[=\s]|:|-p\s+|PORT=|port=)(\d{2,5})/i);
  return m ? m[1] : "";
}

function onPortClick(port) {
  const url = `http://localhost:${port}`;
  openBrowserUrl(url);
  notify(`正在打开浏览器: ${url}`);
}

function statusOf(command) {
  const key = keyOf(command);
  const isTask = isTaskCommand(command);
  if (runningOf(key)) return { state: "running", label: "运行中" };
  const exit = store.lastExitByCommand.get(key);
  if (!exit) return { state: "stopped", label: isTask ? "待执行" : "待启动" };
  if (exit.code != null && exit.code !== 0) return { state: "error", label: `退出 ${exit.code}` };
  return { state: isTask ? "task-done" : "stopped", label: isTask ? "已完成" : "已停止" };
}

function uptimeOf(command) {
  const p = runningOf(keyOf(command));
  if (p) return formatDuration(store.now.value - p.startedAtMs);
  return "";
}

/** 运行中与异常退出的命令统计 (冒泡感知) */
const runningCommandsCount = computed(() => {
  let count = 0;
  for (const cmd of props.project.commands ?? []) {
    if (runningOf(keyOf(cmd))) count++;
  }
  return count;
});

const errorCommandsCount = computed(() => {
  let count = 0;
  for (const cmd of props.project.commands ?? []) {
    const exit = store.lastExitByCommand.get(keyOf(cmd));
    if (exit && exit.code != null && exit.code !== 0 && !runningOf(keyOf(cmd))) {
      count++;
    }
  }
  return count;
});

/** 过滤逻辑 */
const visibleCommands = computed(() => {
  const list = props.project.commands ?? [];
  if (!treeFilter) return list;
  const q = treeFilter.search?.value?.trim().toLowerCase() || "";
  const st = treeFilter.status?.value || "all";

  return list.filter((cmd) => {
    const isRunning = runningOf(keyOf(cmd)) != null;
    const isTask = isTaskCommand(cmd);
    const exit = store.lastExitByCommand.get(keyOf(cmd));
    const isErr = exit && exit.code != null && exit.code !== 0 && !isRunning;

    if (st === "running" && !isRunning) return false;
    if (st === "error" && !isErr) return false;
    if (st === "task" && !isTask) return false;

    if (q) {
      const matchProject = props.project.name?.toLowerCase().includes(q);
      const matchName = cmd.name?.toLowerCase().includes(q);
      const matchCmd = cmd.cmd?.toLowerCase().includes(q);
      const port = portNumberOf(cmd.cmd);
      const matchPort = port && port.includes(q);
      return matchProject || matchName || matchCmd || matchPort;
    }

    return true;
  });
});

const isProjectVisible = computed(() => {
  if (!treeFilter) return true;
  const q = treeFilter.search?.value?.trim().toLowerCase() || "";
  const st = treeFilter.status?.value || "all";
  if (!q && st === "all") return true;
  return visibleCommands.value.length > 0;
});

/** 搜索过滤时自动展开 */
const isExpanded = computed(() => {
  if (treeFilter?.search?.value?.trim() || treeFilter?.status?.value !== "all") {
    return true;
  }
  return !props.project.collapsed;
});

async function onDelete() {
  if (
    await confirmAction(`删除项目「${props.project.name}」?\n其下所有命令将一并删除。`, {
      title: "删除项目",
      danger: true,
    })
  ) {
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

function openProjectMenu(e) {
  const items = [
    {
      label: "启动全部服务",
      icon: Play,
      action: () => startProject(props.project),
    },
    {
      label: "停止全部服务",
      icon: Square,
      disabled: runningCommandsCount.value === 0,
      danger: true,
      action: () => stopProject(props.project),
    },
    { divider: true },
    {
      label: "新建命令",
      icon: Plus,
      action: () => handlers.create({ kind: "command", mode: "create", project: props.project }),
    },
    {
      label: "在文件管理器中打开",
      icon: FolderOpen,
      action: () => openIn(openDirInExplorer),
    },
    {
      label: "在控制台中打开",
      icon: SquareTerminal,
      action: () => openIn(openTerminal),
    },
    {
      label: "复制项目目录",
      icon: Copy,
      disabled: !props.project.dir,
      action: () => copyToClipboard(props.project.dir, "已复制项目目录"),
    },
    { divider: true },
    {
      label: props.project.collapsed ? "展开项目" : "折叠项目",
      action: toggle,
    },
    {
      label: "编辑项目",
      icon: Pencil,
      action: () => handlers.edit({ kind: "project", mode: "edit", project: props.project }),
    },
    { divider: true },
    {
      label: "删除项目",
      icon: Trash2,
      danger: true,
      action: onDelete,
    },
  ];

  openContextMenu?.(e, items);
}

function onProjectMoreClick(e) {
  const rect = e.currentTarget.getBoundingClientRect();
  openProjectMenu({ clientX: rect.right, clientY: rect.bottom });
}

function openCmdMenu(e, command) {
  const key = keyOf(command);
  const isRunning = runningOf(key) != null;
  const port = portNumberOf(command.cmd);
  const pid = isRunning ? runningOf(key)?.pid : store.lastPidByCommand.get(key);

  const items = [
    isRunning
      ? {
          label: "停止",
          icon: Square,
          danger: true,
          action: () => stopPid(runningOf(key).pid),
        }
      : {
          label: "启动",
          icon: Play,
          action: () => startCommand(props.project, command),
        },
    ...(isRunning
      ? [
          {
            label: "重启",
            icon: RotateCw,
            action: () => restartCommand(props.project, command),
          },
        ]
      : []),
    ...(port
      ? [
          {
            label: `在浏览器中打开 (: ${port})`,
            icon: ExternalLink,
            action: () => onPortClick(port),
          },
        ]
      : []),
    { divider: true },
    {
      label: "复制启动命令",
      icon: Copy,
      action: () => copyToClipboard(command.cmd, "已复制命令"),
    },
    {
      label: "克隆命令",
      icon: Plus,
      action: () => duplicateCommand(props.project, command),
    },
    {
      label: "清空日志",
      disabled: !pid || !store.logs.has(pid),
      action: () => clearLog(pid),
    },
    { divider: true },
    {
      label: "编辑命令",
      icon: Pencil,
      action: () => handlers.edit({ kind: "command", mode: "edit", project: props.project, command }),
    },
    {
      label: "删除命令",
      icon: Trash2,
      danger: true,
      action: () => onDeleteCommand(command),
    },
  ];

  openContextMenu?.(e, items);
}

// ---- 项目拖拽排序 ----
function onProjectDragStart(e) {
  e.dataTransfer.setData("application/x-xon-project", String(props.index));
  e.dataTransfer.effectAllowed = "move";
}

function onProjectDragOver(e) {
  if (e.dataTransfer.types.includes("application/x-xon-project")) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    isProjectDragOver.value = true;
  }
}

function onProjectDrop(e) {
  isProjectDragOver.value = false;
  const raw = e.dataTransfer.getData("application/x-xon-project");
  if (raw === "") return;
  const fromIndex = parseInt(raw, 10);
  if (!isNaN(fromIndex)) {
    reorderProjects(fromIndex, props.index);
  }
}

// ---- 内部命令拖拽排序 ----
function onCmdDragStart(e, cmdIdx) {
  e.dataTransfer.setData("application/x-xon-cmd", String(cmdIdx));
  e.dataTransfer.effectAllowed = "move";
}

function onCmdDragOver(e, cmdIdx) {
  if (e.dataTransfer.types.includes("application/x-xon-cmd")) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    cmdDragOverIdx.value = cmdIdx;
  }
}

function onCmdDrop(e, cmdIdx) {
  cmdDragOverIdx.value = -1;
  const raw = e.dataTransfer.getData("application/x-xon-cmd");
  if (raw === "") return;
  const fromIdx = parseInt(raw, 10);
  if (!isNaN(fromIdx)) {
    reorderCommands(props.project, fromIdx, cmdIdx);
  }
}
</script>

<template>
  <div v-show="isProjectVisible" class="project-wrap">
    <!-- 项目行 -->
    <div
      class="row project-row"
      :class="{ 'drop-target': isProjectDragOver }"
      draggable="true"
      @dragstart="onProjectDragStart"
      @dragover="onProjectDragOver"
      @dragleave="isProjectDragOver = false"
      @drop="onProjectDrop"
      @click="toggle"
      @contextmenu.prevent="openProjectMenu"
    >
      <ChevronDown class="chevron" :class="{ collapsed: !isExpanded }" @click.stop="toggle" />
      <Package class="row-icon project-icon" />
      <span class="project-name" :title="project.dir ? `${project.name} (${project.dir})` : project.name">
        {{ project.name }}
      </span>
      <span class="count">{{ project.commands?.length ?? 0 }}</span>

      <!-- 冒泡状态徽章: 折叠时也能感知内部运行/异常 -->
      <span v-if="runningCommandsCount > 0" class="bubble-badge running" title="该项目有服务运行中">
        <span class="badge-dot"></span>
        {{ runningCommandsCount }}
      </span>
      <span v-if="errorCommandsCount > 0" class="bubble-badge error" title="该项目有服务异常退出">
        ! {{ errorCommandsCount }}
      </span>

      <!-- 悬停操作按键: 极简 3 键 -->
      <span class="row-actions">
        <button
          v-if="runningCommandsCount > 0"
          class="btn-ghost icon-btn is-danger"
          title="停止该项目所有服务"
          @click.stop="stopProject(project)"
        >
          <Square />
        </button>
        <button
          v-else
          class="btn-ghost icon-btn is-accent"
          title="启动该项目所有服务"
          @click.stop="startProject(project)"
        >
          <Play />
        </button>
        <button
          class="btn-ghost icon-btn"
          title="新建命令"
          @click.stop="handlers.create({ kind: 'command', mode: 'create', project })"
        >
          <Plus />
        </button>
        <button
          class="btn-ghost icon-btn"
          title="更多操作"
          @click.stop="onProjectMoreClick"
        >
          <MoreHorizontal />
        </button>
      </span>
    </div>

    <!-- 命令行列表(单层直接缩进,空间利用率最大化) -->
    <div v-if="isExpanded" class="tree-children">
      <div
        v-for="(command, cmdIdx) in visibleCommands"
        :key="command.id"
        class="row cmd-row"
        :class="{
          'is-active': isSelected(command),
          'is-running': runningOf(keyOf(command)),
          'drop-target': cmdDragOverIdx === cmdIdx,
        }"
        draggable="true"
        role="button"
        tabindex="0"
        :aria-selected="isSelected(command)"
        @dragstart.stop="onCmdDragStart($event, cmdIdx)"
        @dragover.stop.prevent="onCmdDragOver($event, cmdIdx)"
        @dragleave.stop="cmdDragOverIdx = -1"
        @drop.stop="onCmdDrop($event, cmdIdx)"
        @click="select(command)"
        @keydown.enter.prevent="select(command)"
        @keydown.space.prevent="select(command)"
        @contextmenu.prevent="openCmdMenu($event, command)"
      >
        <!-- 统一状态图标槽位: 严格固定尺寸与居中对齐,保证服务与任务行缩进绝对一致 -->
        <span class="cmd-status-box" :title="isTaskCommand(command) ? '执行任务' : statusOf(command).label">
          <Terminal v-if="isTaskCommand(command)" class="cmd-task-icon" />
          <span v-else class="status-dot" :class="statusOf(command).state">
            <span class="dot-inner"></span>
          </span>
        </span>

        <!-- 命令名 -->
        <span class="cmd-name" :title="command.cmd">{{ command.name }}</span>

        <!-- 端口徽章 (点击可直接在浏览器打开) -->
        <span
          v-if="portNumberOf(command.cmd)"
          class="cmd-port-badge"
          title="点击在默认浏览器中打开 http://localhost:..."
          @click.stop="onPortClick(portNumberOf(command.cmd))"
        >
          :{{ portNumberOf(command.cmd) }}
        </span>

        <!-- 智能清洗后的纯净命令摘要 (去除冗余 JVM 内存参数) -->
        <span class="cmd-snippet" :title="command.cmd">{{ cleanCmdSnippet(command.cmd) }}</span>

        <!-- 运行时长 / 退出状态 -->
        <span v-if="statusOf(command).state === 'running'" class="cmd-uptime">{{ uptimeOf(command) }}</span>
        <span v-else-if="statusOf(command).state === 'error'" class="cmd-exit-code">{{ statusOf(command).label }}</span>
        <span v-else-if="statusOf(command).state === 'task-done'" class="cmd-task-done">已完成</span>

        <!-- 悬停操作按键: 极度克制,仅启停与更多 -->
        <span class="row-actions">
          <button
            v-if="!runningOf(keyOf(command))"
            class="btn-ghost icon-btn is-accent"
            :title="isTaskCommand(command) ? '执行任务' : '启动服务'"
            @click.stop="startCommand(project, command)"
          >
            <Play />
          </button>
          <template v-else>
            <button
              class="btn-ghost icon-btn is-danger"
              title="停止"
              @click.stop="stopPid(runningOf(keyOf(command)).pid)"
            >
              <Square />
            </button>
            <button
              class="btn-ghost icon-btn"
              title="重启"
              @click.stop="restartCommand(project, command)"
            >
              <RotateCw />
            </button>
          </template>
          <button
            class="btn-ghost icon-btn"
            title="更多操作"
            @click.stop="openCmdMenu($event, command)"
          >
            <MoreHorizontal />
          </button>
        </span>
      </div>

      <p v-if="project.commands?.length === 0" class="inline-empty">
        暂无命令 — 点击项目行 + 新建
      </p>
    </div>
  </div>
</template>

<style scoped>
.project-wrap {
  margin-bottom: 2px;
}
.project-icon {
  color: var(--color-accent);
  opacity: 0.85;
}
</style>
