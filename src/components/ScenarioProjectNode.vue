<script setup>
// 方案编辑 - 项目节点:仅展示服务名与延时设置，彻底去掉命令脚本与多余嵌套
import { computed, inject } from "vue";
import { ChevronDown, ChevronRight, Package } from "lucide-vue-next";

defineOptions({ name: "ScenarioProjectNode" });

const props = defineProps({
  project: { type: Object, required: true },
});

const ctx = inject("scenarioContext");

const commands = computed(() => props.project.commands ?? []);

/** 根据搜索过滤服务命令 */
const visibleCommands = computed(() => {
  return commands.value.filter((cmd) => ctx.isCommandVisible(cmd, props.project));
});

const isCollapsed = computed(() => ctx.isProjectCollapsed(props.project.id));
const isChecked = computed(() => ctx.isProjectChecked(props.project));
const isIndeterminate = computed(() => ctx.isProjectIndeterminate(props.project));

const selectedCount = computed(() => {
  return commands.value.filter((c) => ctx.checked[ctx.commandKey(props.project.id, c.id)]).length;
});

function toggleCollapse() {
  ctx.toggleProjectCollapse(props.project.id);
}

function onHeaderCheckboxClick(e) {
  e.stopPropagation();
  ctx.toggleProject(props.project);
}

function onRowClick(key) {
  ctx.toggleCommand(key);
}
</script>

<template>
  <div v-show="ctx.isProjectVisible(project)" class="project-item-wrap">
    <!-- 项目分组头 -->
    <div class="project-header" @click="toggleCollapse">
      <button
        type="button"
        class="toggle-btn"
        :aria-label="isCollapsed ? '展开项目' : '折叠项目'"
        @click.stop="toggleCollapse"
      >
        <ChevronDown v-if="!isCollapsed" class="chevron-icon" />
        <ChevronRight v-else class="chevron-icon" />
      </button>

      <label class="checkbox-wrap" @click.stop>
        <input
          type="checkbox"
          :checked="isChecked"
          :indeterminate="isIndeterminate"
          @click="onHeaderCheckboxClick"
        />
      </label>

      <Package class="project-icon" />
      <span class="project-name">{{ project.name }}</span>

      <span v-if="project.groupPath && project.groupPath !== project.name" class="project-group-tag">
        {{ project.groupPath }}
      </span>

      <span v-if="project.dir" class="project-dir" :title="project.dir">
        {{ project.dir }}
      </span>

      <span class="count-badge">
        {{ selectedCount }}/{{ commands.length }}
      </span>
    </div>

    <!-- 服务列表 (去除命令脚本，仅展示名称与延时) -->
    <div v-show="!isCollapsed" class="command-list">
      <div
        v-for="cmd in visibleCommands"
        :key="cmd.id"
        class="cmd-row"
        :class="{ 'is-checked': !!ctx.checked[ctx.commandKey(project.id, cmd.id)] }"
        :title="cmd.cmd ? `启动命令: ${cmd.cmd}` : undefined"
        @click="onRowClick(ctx.commandKey(project.id, cmd.id))"
      >
        <label class="checkbox-wrap" @click.stop>
          <input
            type="checkbox"
            :checked="!!ctx.checked[ctx.commandKey(project.id, cmd.id)]"
            @change="ctx.toggleCommand(ctx.commandKey(project.id, cmd.id))"
          />
        </label>

        <!-- 服务名称与状态 -->
        <div class="cmd-meta">
          <span class="cmd-title">{{ cmd.name }}</span>
          <span v-if="cmd.port" class="port-tag">:{{ cmd.port }}</span>
          <span v-if="ctx.runningOf(ctx.commandKey(project.id, cmd.id))" class="running-tag">
            <span class="dot"></span>运行中
          </span>
        </div>

        <div class="row-spacer"></div>

        <!-- 极简延时设置 -->
        <div
          class="delay-stepper"
          :class="{
            'is-disabled': !ctx.checked[ctx.commandKey(project.id, cmd.id)],
            'has-delay': (ctx.delays[ctx.commandKey(project.id, cmd.id)] || 0) > 0,
          }"
          @click.stop
        >
          <span class="delay-label">延时</span>
          <input
            v-model.number="ctx.delays[ctx.commandKey(project.id, cmd.id)]"
            type="number"
            min="0"
            max="3600"
            class="delay-input"
            placeholder="0"
            :disabled="!ctx.checked[ctx.commandKey(project.id, cmd.id)]"
          />
          <span class="delay-unit">秒</span>
        </div>
      </div>

      <div v-if="visibleCommands.length === 0" class="empty-hint">
        无匹配服务
      </div>
    </div>
  </div>
</template>

<style scoped>
.project-item-wrap {
  display: flex;
  flex-direction: column;
}

.project-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  user-select: none;
  transition: background var(--dur-fast) var(--ease);
}
.project-header:hover {
  background: rgba(236, 239, 244, 0.06);
}

.toggle-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: var(--color-muted-foreground);
  padding: 2px;
  cursor: pointer;
  border-radius: var(--radius-sm);
}
.toggle-btn:hover {
  color: var(--color-foreground);
  background: var(--overlay-hover);
}
.chevron-icon {
  width: 14px;
  height: 14px;
}

.checkbox-wrap {
  display: inline-flex;
  align-items: center;
  cursor: pointer;
}
.checkbox-wrap input[type="checkbox"] {
  width: 15px;
  height: 15px;
  accent-color: var(--color-accent);
  cursor: pointer;
  margin: 0;
}

.project-icon {
  width: 15px;
  height: 15px;
  color: var(--nord-9);
  flex: none;
}

.project-name {
  font-weight: 600;
  font-size: 0.92rem;
  color: var(--color-foreground);
  flex: none;
}

.project-group-tag {
  font-size: 0.73rem;
  color: var(--nord-8);
  background: rgba(136, 192, 208, 0.12);
  padding: 1px 6px;
  border-radius: 4px;
  flex: none;
}

.project-dir {
  font-family: var(--font-mono);
  font-size: 0.76rem;
  color: var(--color-muted-foreground);
  opacity: 0.55;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 220px;
}

.count-badge {
  margin-left: auto;
  font-size: 0.77rem;
  font-variant-numeric: tabular-nums;
  color: var(--color-muted-foreground);
  background: rgba(0, 0, 0, 0.2);
  padding: 1px 7px;
  border-radius: 10px;
}

/* 服务列表缩进 */
.command-list {
  margin-left: 14px;
  border-left: 1px solid rgba(236, 239, 244, 0.09);
  padding-left: 6px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

/* 单条服务行 */
.cmd-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease);
}
.cmd-row:hover {
  background: rgba(236, 239, 244, 0.05);
}
.cmd-row.is-checked {
  background: rgba(136, 192, 208, 0.08);
}
.cmd-row.is-checked:hover {
  background: rgba(136, 192, 208, 0.12);
}

.cmd-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}

.cmd-title {
  font-size: 0.9231rem;
  font-weight: 500;
  color: var(--color-foreground);
}

.port-tag {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--nord-8);
  background: rgba(136, 192, 208, 0.15);
  padding: 0 4px;
  border-radius: 3px;
}

.running-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.73rem;
  color: var(--color-success);
  background: rgba(163, 190, 140, 0.15);
  padding: 0 6px;
  border-radius: 10px;
}
.running-tag .dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--color-success);
}

.row-spacer {
  flex: 1;
}

/* 延时设置 */
.delay-stepper {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
  font-size: 0.78rem;
  color: var(--color-muted-foreground);
}
.delay-stepper.is-disabled {
  opacity: 0.22;
  pointer-events: none;
}
.delay-label {
  font-size: 0.76rem;
  opacity: 0.75;
}
.delay-stepper.has-delay {
  color: var(--nord-13);
}
.delay-stepper.has-delay .delay-label {
  color: var(--nord-13);
  font-weight: 500;
  opacity: 1;
}

.delay-input {
  width: 38px;
  height: 22px;
  padding: 0 3px;
  font-family: var(--font-mono);
  font-size: 0.82rem;
  text-align: center;
  background: rgba(0, 0, 0, 0.25);
  color: var(--color-foreground);
  border: 1px solid rgba(236, 239, 244, 0.15);
  border-radius: var(--radius-sm);
  transition: all var(--dur-fast) var(--ease);
}
.delay-stepper.has-delay .delay-input {
  border-color: rgba(235, 203, 139, 0.45);
  background: rgba(235, 203, 139, 0.12);
  color: var(--nord-13);
  font-weight: 500;
}
.delay-input:focus {
  border-color: var(--color-accent);
  background: var(--input-bg);
  outline: none;
}

.delay-unit {
  font-size: 0.76rem;
}

.empty-hint {
  padding: 4px 8px;
  font-size: 0.8rem;
  color: var(--color-muted-foreground);
  font-style: italic;
}
</style>
