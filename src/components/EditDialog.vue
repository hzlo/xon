<script setup>
// 新建/编辑 分组、项目、命令 共用一个对话框;kind 决定渲染哪些字段。
import { nextTick, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { FolderOpen } from "lucide-vue-next";
import { pickFolder } from "../api.js";

const props = defineProps({
  kind: { type: String, required: true }, // group | project | command
  title: { type: String, required: true },
  /** 编辑时的初始值 */
  initial: { type: Object, default: () => ({}) },
  /** 占位符等上下文,如项目目录 */
  defaults: { type: Object, default: () => ({}) },
});
const emit = defineEmits(["submit", "cancel"]);

const form = reactive({
  name: props.initial.name ?? "",
  dir: props.initial.dir ?? "",
  cmd: props.initial.cmd ?? "",
  cwd: props.initial.cwd ?? "",
  envText: Object.entries(props.initial.env ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join("\n"),
});
const errors = reactive({ name: "", cmd: "" });
const nameInput = ref(null);

function onKeydown(e) {
  if (e.key === "Escape") emit("cancel");
}
onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  nextTick(() => nameInput.value?.focus());
});
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));

/** 系统文件夹选择器,选中后回填到指定字段 */
async function browseDir(field) {
  try {
    const dir = await pickFolder();
    if (dir) form[field] = dir;
  } catch {
    /* 用户取消或环境不支持,保持原值 */
  }
}

function submit() {
  errors.name = form.name.trim() ? "" : "名称必填";
  if (props.kind === "command") errors.cmd = form.cmd.trim() ? "" : "命令必填";
  if (errors.name || errors.cmd) return;

  const env = {};
  for (const raw of form.envText.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  emit("submit", {
    name: form.name.trim(),
    dir: form.dir.trim(),
    cmd: form.cmd.trim(),
    cwd: form.cwd.trim(),
    env,
  });
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('cancel')">
    <div class="modal" role="dialog" aria-modal="true" :aria-label="title" @submit.prevent="submit">
      <h2 class="modal-title">{{ title }}</h2>

      <form @submit.prevent="submit">
        <div class="field">
          <label :for="`${kind}-name`">名称</label>
          <input
            :id="`${kind}-name`"
            ref="nameInput"
            v-model="form.name"
            class="input"
            type="text"
            :aria-invalid="errors.name ? 'true' : undefined"
            placeholder="如:前端服务"
          />
          <span v-if="errors.name" class="field-error">{{ errors.name }}</span>
        </div>

        <div v-if="kind === 'project'" class="field">
          <label for="project-dir">项目目录</label>
          <div class="dir-row">
            <input id="project-dir" v-model="form.dir" class="input" type="text" placeholder="D:\path\to\project" />
            <button type="button" class="btn-secondary browse-btn" aria-label="浏览选择项目目录" @click="browseDir('dir')">
              <FolderOpen />浏览…
            </button>
          </div>
        </div>

        <template v-if="kind === 'command'">
          <div class="field">
            <label for="command-cmd">命令</label>
            <input
              id="command-cmd"
              v-model="form.cmd"
              class="input command-input"
              type="text"
              :aria-invalid="errors.cmd ? 'true' : undefined"
              placeholder="npm run dev"
            />
            <span v-if="errors.cmd" class="field-error">{{ errors.cmd }}</span>
          </div>
          <div class="field">
            <label for="command-cwd">工作目录</label>
            <div class="dir-row">
              <input
                id="command-cwd"
                v-model="form.cwd"
                class="input"
                type="text"
                :placeholder="defaults.dir ? `留空则使用项目目录(${defaults.dir})` : '留空则使用项目目录'"
              />
              <button type="button" class="btn-secondary browse-btn" aria-label="浏览选择工作目录" @click="browseDir('cwd')">
                <FolderOpen />浏览…
              </button>
            </div>
          </div>
          <div class="field">
            <label for="command-env">环境变量(每行 KEY=VALUE)</label>
            <textarea id="command-env" v-model="form.envText" class="textarea" rows="3" placeholder="NODE_ENV=development"></textarea>
          </div>
        </template>

        <div class="modal-actions">
          <button type="button" class="btn-secondary" @click="emit('cancel')">取消</button>
          <button type="submit" class="btn-primary">保存</button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.modal-title {
  margin: 0 0 var(--space-xl);
  font-size: 14px;
  font-weight: 600;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-md);
  margin-top: var(--space-xl);
}
.command-input {
  font-family: var(--font-mono);
  font-size: 12px;
}
.dir-row {
  display: flex;
  gap: var(--space-sm);
  align-items: center;
}
.dir-row .input {
  flex: 1;
}
.browse-btn {
  flex: none;
  padding: 5px 10px;
  font-size: 12px;
}
</style>
