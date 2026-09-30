<script setup>
// 运行方案管理:命名 + 勾选要批量启动的命令(分组树扁平化展示,顺序即启动顺序)。
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { commandKey, runningOf, store } from "../stores/app.js";

const props = defineProps({
  /** 编辑时传入 { id, name, items } */
  initial: { type: Object, default: null },
});
const emit = defineEmits(["submit", "cancel", "pick"]);

const form = reactive({
  name: props.initial?.name ?? "",
});
/** key → 勾选状态;提交时按配置树顺序输出,保证批量启动顺序稳定 */
const checked = reactive(
  Object.fromEntries((props.initial?.items ?? []).map((it) => [`${it.projectId}/${it.commandId}`, true])),
);
const nameInput = ref(null);

/** 配置树 → 扁平命令列表(路径标签保留层级信息) */
const flatCommands = computed(() => {
  const out = [];
  const walkProject = (project, path) => {
    for (const command of project.commands ?? []) {
      out.push({
        key: commandKey(project.id, command.id),
        projectId: project.id,
        commandId: command.id,
        path: [...path, project.name].join(" / "),
        name: command.name,
        cmd: command.cmd,
      });
    }
  };
  const walkGroup = (group, path) => {
    const next = [...path, group.name];
    for (const child of group.groups ?? []) walkGroup(child, next);
    for (const project of group.projects ?? []) walkProject(project, next);
  };
  for (const group of store.config.groups ?? []) walkGroup(group, []);
  for (const project of store.config.projects ?? []) walkProject(project, []);
  return out;
});

function onKeydown(e) {
  if (e.key === "Escape") emit("cancel");
}
onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  nextTick(() => nameInput.value?.focus());
});
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));

const checkedCount = () => Object.values(checked).filter(Boolean).length;

function submit() {
  if (!form.name.trim()) return;
  const items = [];
  for (const group of store.config.groups) {
    for (const project of group.projects) {
      for (const command of project.commands) {
        if (checked[commandKey(project.id, command.id)]) {
          items.push({ projectId: project.id, commandId: command.id });
        }
      }
    }
  }
  emit("submit", { name: form.name.trim(), items });
}

defineExpose({ checkedCount });
</script>

<template>
  <div class="modal-overlay" @click.self="emit('cancel')">
    <div class="modal" role="dialog" aria-modal="true" aria-label="运行方案">
      <h2 class="modal-title">{{ initial ? "编辑方案" : "新建方案" }}</h2>

      <form @submit.prevent="submit">
        <div v-if="!initial && store.scenarios.value.length > 0" class="existing-row">
          <span class="existing-label">编辑已有:</span>
          <button
            v-for="s in store.scenarios.value"
            :key="s.id"
            type="button"
            class="btn-ghost existing-chip"
            @click="emit('pick', s)"
          >
            {{ s.name }}({{ s.items.length }})
          </button>
        </div>

        <div class="field">
          <label for="scenario-name">方案名称</label>
          <input
            id="scenario-name"
            ref="nameInput"
            v-model="form.name" autocomplete="off" spellcheck="false" autocapitalize="off"
            class="input"
            type="text"
            placeholder="如:前端开发环境"
          />
        </div>

        <div class="field">
          <label>包含的命令(按此顺序批量启动)</label>
          <div class="scenario-tree">
            <label
              v-for="entry in flatCommands"
              :key="entry.key"
              class="tree-command"
              :title="entry.path"
            >
              <input v-model="checked[entry.key]" type="checkbox" />
              <span class="cmd">{{ entry.name }}</span>
              <span class="snippet">{{ entry.path }} · {{ entry.cmd }}</span>
              <span v-if="runningOf(entry.key)" class="live">运行中</span>
            </label>
            <p v-if="flatCommands.length === 0" class="tree-empty">还没有命令,先去左侧创建</p>
          </div>
        </div>

        <div class="modal-actions">
          <button type="button" class="btn-secondary" @click="emit('cancel')">取消</button>
          <button type="submit" class="btn-primary" :disabled="checkedCount() === 0 || !form.name.trim()">
            保存
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.modal {
  width: min(560px, calc(100vw - 48px));
}
.modal-title {
  margin: 0 0 var(--space-xl);
  font-size: 14px;
  font-weight: 600;
}
.scenario-tree {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-muted);
  padding: var(--space-md);
  max-height: 320px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}
.tree-group {
  margin: var(--space-sm) 0 0;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-muted-foreground);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.tree-project {
  margin-left: var(--space-md);
  font-size: 12px;
  color: var(--color-muted-foreground);
  cursor: default;
}
.tree-command {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin-left: var(--space-xl);
  padding: 2px 4px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 13px;
}
.tree-command:hover {
  background: var(--color-secondary);
}
.tree-command input {
  accent-color: var(--color-accent);
}
.cmd {
  flex: none;
}
.snippet {
  flex: 1;
  min-width: 0;
  font: 400 11px/1.4 var(--font-mono);
  color: var(--color-muted-foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.live {
  font-size: 11px;
  color: var(--color-accent-text);
}
.tree-empty {
  color: var(--color-muted-foreground);
  font-size: 12px;
  padding: var(--space-md);
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-md);
  margin-top: var(--space-xl);
}
.existing-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex-wrap: wrap;
  margin-bottom: var(--space-lg);
}
.existing-label {
  font-size: 12px;
  color: var(--color-muted-foreground);
}
.existing-chip {
  font-size: 12px;
  padding: 3px 8px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}
</style>
