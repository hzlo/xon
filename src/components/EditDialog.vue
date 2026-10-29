<script setup>
// 新建/编辑 分组、项目、命令、基础设施服务 共用一个对话框;kind 决定渲染哪些字段。
import { nextTick, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { FolderOpen } from "lucide-vue-next";
import { pickFolder } from "../api.js";
import { isTaskCommand } from "../stores/app.js";

const props = defineProps({
  kind: { type: String, required: true }, // group | project | command | infra
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
  stopCmd: props.initial.stopCmd ?? "",
  shell: props.initial.shell ?? "cmd",
  cwd: props.initial.cwd ?? "",
  kindType: props.initial.kind ?? (props.initial.cmd ? (isTaskCommand(props.initial) ? "task" : "service") : "service"),
  autoStart: props.initial.autoStart ?? false,
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
  if (props.kind === "command" || props.kind === "infra") {
    errors.cmd = form.cmd.trim() ? "" : "启动命令必填";
  }
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
    stopCmd: form.stopCmd.trim(),
    shell: form.shell || "cmd",
    cwd: form.cwd.trim(),
    kind: form.kindType,
    autoStart: !!form.autoStart,
    env,
  });
}
</script>

<template>
  <div class="modal-overlay">
    <div class="modal" role="dialog" aria-modal="true" :aria-label="title">
      <h2 class="modal-title">{{ title }}</h2>

      <form @submit.prevent="submit">
        <div class="field">
          <label :for="`${kind}-name`">名称</label>
          <input
            :id="`${kind}-name`"
            ref="nameInput"
            v-model="form.name" autocomplete="off" spellcheck="false" autocapitalize="off"
            class="input"
            type="text"
            :aria-invalid="errors.name ? 'true' : undefined"
            :placeholder="kind === 'infra' ? '如: WSL 或 Docker' : '如: 前端服务'"
          />
          <span v-if="errors.name" class="field-error">{{ errors.name }}</span>
        </div>

        <div v-if="kind === 'command'" class="field">
          <label>模式类型</label>
          <div class="kind-segmented">
            <button
              type="button"
              class="seg-btn"
              :class="{ active: form.kindType === 'service' }"
              @click="form.kindType = 'service'"
            >
              常驻服务 (Service)
            </button>
            <button
              type="button"
              class="seg-btn"
              :class="{ active: form.kindType === 'task' }"
              @click="form.kindType = 'task'"
            >
              执行任务 (Task / Build)
            </button>
          </div>
        </div>

        <div v-if="kind === 'infra'" class="field">
          <label class="checkbox-label">
            <input type="checkbox" v-model="form.autoStart" />
            <span>随 XON 启动时自动运行此服务</span>
          </label>
        </div>

        <div v-if="kind === 'project'" class="field">
          <label for="project-dir">项目目录</label>
          <div class="dir-row">
            <input id="project-dir" v-model="form.dir" class="input" type="text" autocomplete="off" spellcheck="false" autocapitalize="off" placeholder="D:\path\to\project" />
            <button type="button" class="btn-secondary browse-btn" aria-label="浏览选择项目目录" @click="browseDir('dir')">
              <FolderOpen />浏览…
            </button>
          </div>
        </div>

        <template v-if="kind === 'command' || kind === 'infra'">
          <div class="field">
            <label for="command-cmd">启动命令</label>
            <input
              id="command-cmd"
              v-model="form.cmd"
              class="input command-input"
              type="text"
              :aria-invalid="errors.cmd ? 'true' : undefined"
              :placeholder="kind === 'infra' ? '如: wsl bash -c &quot;sleep infinity&quot;' : 'npm run dev'"
            />
            <span v-if="errors.cmd" class="field-error">{{ errors.cmd }}</span>
          </div>
          <div class="field">
            <label for="command-stop-cmd">
              停止命令
              <span class="field-hint">(可选: 停止时优先执行此命令以优雅退出/关机)</span>
            </label>
            <input
              id="command-stop-cmd"
              v-model="form.stopCmd"
              class="input command-input"
              type="text"
              autocomplete="off"
              spellcheck="false"
              autocapitalize="off"
              :placeholder="kind === 'infra' ? '如: wsl --shutdown 或 docker compose down' : '可选，如: nginx -s stop'"
            />
          </div>
          <div class="field">
            <label for="command-shell">Shell</label>
            <select id="command-shell" v-model="form.shell" class="input">
              <option value="cmd">Cmd (cmd.exe)</option>
              <option value="powershell">PowerShell (powershell.exe)</option>
            </select>
          </div>
          <div class="field">
            <label for="command-cwd">工作目录</label>
            <div class="dir-row">
              <input
                id="command-cwd"
                v-model="form.cwd"
                class="input"
                type="text"
                :placeholder="defaults.dir ? `留空则使用项目目录(${defaults.dir})` : '留空则使用默认目录'"
              />
              <button type="button" class="btn-secondary browse-btn" aria-label="浏览选择工作目录" @click="browseDir('cwd')">
                <FolderOpen />浏览…
              </button>
            </div>
          </div>
          <div class="field">
            <label for="command-env">环境变量(每行 KEY=VALUE)</label>
            <textarea id="command-env" autocomplete="off" spellcheck="false" v-model="form.envText" class="textarea" rows="3" placeholder="NODE_ENV=development"></textarea>
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
  font-size: 1.0769rem;
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
  font-size: 0.9231rem;
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
  font-size: 0.9231rem;
}
.kind-segmented {
  display: flex;
  background: var(--input-bg);
  border: 1px solid var(--input-border);
  border-radius: var(--radius-sm);
  padding: 2px;
  gap: 2px;
}
.seg-btn {
  flex: 1;
  padding: 6px 12px;
  font-size: 0.85rem;
  background: transparent;
  color: var(--color-muted-foreground);
  border: none;
  border-radius: calc(var(--radius-sm) - 1px);
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease);
}
.seg-btn:hover {
  color: var(--color-foreground);
}
.seg-btn.active {
  background: var(--color-card);
  color: var(--color-foreground);
  font-weight: 500;
  box-shadow: var(--shadow-sm);
}
.field-hint {
  font-size: 0.8rem;
  font-weight: normal;
  color: var(--color-muted-foreground);
  margin-left: 6px;
}
.checkbox-label {
  display: inline-flex;
  align-items: center;
  gap: var(--space-sm);
  font-size: 0.875rem;
  color: var(--color-foreground);
  cursor: pointer;
  user-select: none;
}
.checkbox-label input[type="checkbox"] {
  cursor: pointer;
  accent-color: var(--color-accent);
}
</style>
