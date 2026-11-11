<script setup>
// 新建/编辑 分组、项目、命令、基础设施服务 共用一个对话框;kind 决定渲染哪些字段。
import { nextTick, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { FolderOpen } from "lucide-vue-next";
import { pickFolder } from "../api.js";
import { isTaskCommand } from "../stores/app.js";
import { isWslPath } from "../utils/pipeline.js";

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
  saveDir: props.initial.saveDir ?? "",
  wslDistro: props.initial.wslDistro ?? "",
  cmd: props.initial.cmd ?? "",
  stopCmd: props.initial.stopCmd ?? "",
  shell: props.initial.shell ?? "cmd",
  cwd: props.initial.cwd ?? "",
  kindType: props.initial.kind ?? (props.initial.cmd ? (isTaskCommand(props.initial) ? "task" : "service") : "service"),
  autoStart: props.initial.autoStart ?? false,
  envText: Object.entries(props.initial.env ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join("\n"),
  pipeRepoDir: props.initial.pipeline?.repoDir ?? "",
  pipeGitUrl: props.initial.pipeline?.gitUrl ?? "",
  pipeGitBranch: props.initial.pipeline?.gitBranch ?? "",
  pipeImageName: props.initial.pipeline?.imageName ?? "",
  pipeImageTag: props.initial.pipeline?.imageTag ?? "latest",
  pipeDockerfilePath: props.initial.pipeline?.dockerfilePath ?? "",
  pipeBuildContext: props.initial.pipeline?.buildContext ?? ".",
  pipeGitPull: props.initial.pipeline?.gitPull ?? true,
  pipeExportTar: props.initial.pipeline?.exportTar ?? true,
  pipeSaveDir: props.initial.pipeline?.saveDir ?? "",
  pipeWslDistro: props.initial.pipeline?.wslDistro ?? "",
});
const errors = reactive({
  name: "",
  cmd: "",
  imageName: "",
  dockerfilePath: "",
  repoDir: "",
});
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
  errors.cmd = "";
  errors.imageName = "";
  errors.dockerfilePath = "";
  errors.repoDir = "";

  const isPipeline = props.kind === "command" && form.kindType === "pipeline";

  if (isPipeline) {
    errors.imageName = form.pipeImageName.trim() ? "" : "镜像名称必填";
    errors.dockerfilePath = form.pipeDockerfilePath.trim() ? "" : "Dockerfile 路径必填";
    if (!form.pipeRepoDir.trim() && !(props.defaults.dir || "").trim()) {
      errors.repoDir = "请填写代码仓库目录(或在所属项目中配置项目目录)";
    }
  } else if (props.kind === "command" || props.kind === "infra") {
    errors.cmd = form.cmd.trim() ? "" : "启动命令必填";
  }

  if (errors.name || errors.cmd || errors.imageName || errors.dockerfilePath || errors.repoDir) {
    return;
  }

  const env = {};
  for (const raw of form.envText.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }

  if (isPipeline) {
    emit("submit", {
      name: form.name.trim(),
      dir: "",
      cmd: "",
      stopCmd: "",
      shell: "powershell",
      cwd: isWslPath(form.pipeRepoDir) ? "" : form.pipeRepoDir.trim(),
      kind: "pipeline",
      autoStart: false,
      env,
      pipeline: {
        repoDir: form.pipeRepoDir.trim(),
        gitUrl: form.pipeGitUrl.trim(),
        gitBranch: form.pipeGitBranch.trim(),
        imageName: form.pipeImageName.trim(),
        imageTag: form.pipeImageTag.trim() || "latest",
        dockerfilePath: form.pipeDockerfilePath.trim(),
        buildContext: form.pipeBuildContext.trim() || ".",
        gitPull: !!form.pipeGitPull,
        exportTar: !!form.pipeExportTar,
        saveDir: form.pipeSaveDir.trim(),
        wslDistro: form.pipeWslDistro.trim(),
      },
    });
    return;
  }

  emit("submit", {
    name: form.name.trim(),
    dir: form.dir.trim(),
    saveDir: form.saveDir.trim(),
    wslDistro: form.wslDistro.trim(),
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
              执行任务 (Task)
            </button>
            <button
              type="button"
              class="seg-btn"
              :class="{ active: form.kindType === 'pipeline' }"
              @click="form.kindType = 'pipeline'"
            >
              容器构建 (Docker)
            </button>
          </div>
        </div>

        <div v-if="kind === 'infra'" class="field">
          <label class="checkbox-label">
            <input type="checkbox" v-model="form.autoStart" />
            <span>随 XON 启动时自动运行此服务</span>
          </label>
        </div>

        <template v-if="kind === 'project'">
          <div class="field">
            <label for="project-dir">项目目录</label>
            <div class="dir-row">
              <input id="project-dir" v-model="form.dir" class="input" type="text" autocomplete="off" spellcheck="false" autocapitalize="off" placeholder="D:\path\to\project" />
              <button type="button" class="btn-secondary browse-btn" aria-label="浏览选择项目目录" @click="browseDir('dir')">
                <FolderOpen />浏览…
              </button>
            </div>
          </div>
          <div class="field">
            <label for="project-save-dir">默认产物目录</label>
            <div class="dir-row">
              <input id="project-save-dir" v-model="form.saveDir" class="input" type="text" autocomplete="off" spellcheck="false" autocapitalize="off" placeholder="如: D:\Users\ppooqq\Desktop\ftp\tjlw" />
              <button type="button" class="btn-secondary browse-btn" aria-label="浏览选择产物输出目录" @click="browseDir('saveDir')">
                <FolderOpen />浏览…
              </button>
            </div>
          </div>
          <div class="field">
            <label for="project-wsl-distro">默认 WSL 发行版</label>
            <input id="project-wsl-distro" v-model="form.wslDistro" class="input" type="text" autocomplete="off" spellcheck="false" autocapitalize="off" placeholder="留空使用系统默认，如 Ubuntu-22.04" />
          </div>
        </template>

        <template v-if="kind === 'command' && form.kindType === 'pipeline'">
          <div class="field">
            <label for="pipe-repo-dir">代码仓库目录</label>
            <div class="dir-row">
              <input
                id="pipe-repo-dir"
                v-model="form.pipeRepoDir"
                class="input"
                type="text"
                autocomplete="off"
                spellcheck="false"
                autocapitalize="off"
                :aria-invalid="errors.repoDir ? 'true' : undefined"
                :placeholder="defaults.dir ? `留空继承项目目录(${defaults.dir})` : '如: ~/builds/MES-NET 或 D:\\...'"
              />
              <button type="button" class="btn-secondary browse-btn" aria-label="浏览选择代码仓库目录" @click="browseDir('pipeRepoDir')">
                <FolderOpen />浏览…
              </button>
            </div>
            <span v-if="errors.repoDir" class="field-error">{{ errors.repoDir }}</span>
          </div>

          <div class="form-row-2">
            <div class="field">
              <label for="pipe-git-url">Git 仓库地址</label>
              <input
                id="pipe-git-url"
                v-model="form.pipeGitUrl"
                class="input command-input"
                type="text"
                autocomplete="off"
                spellcheck="false"
                autocapitalize="off"
                placeholder="可选，目录不存在时自动 clone"
              />
            </div>
            <div class="field">
              <label for="pipe-git-branch">分支</label>
              <input
                id="pipe-git-branch"
                v-model="form.pipeGitBranch"
                class="input command-input"
                type="text"
                autocomplete="off"
                spellcheck="false"
                autocapitalize="off"
                placeholder="默认分支"
              />
            </div>
          </div>

          <div class="form-row-2">
            <div class="field">
              <label for="pipe-image-name">镜像名称</label>
              <input
                id="pipe-image-name"
                v-model="form.pipeImageName"
                class="input command-input"
                type="text"
                autocomplete="off"
                spellcheck="false"
                autocapitalize="off"
                :aria-invalid="errors.imageName ? 'true' : undefined"
                placeholder="如: tj-mes-dev"
              />
              <span v-if="errors.imageName" class="field-error">{{ errors.imageName }}</span>
            </div>
            <div class="field">
              <label for="pipe-image-tag">Tag</label>
              <input
                id="pipe-image-tag"
                v-model="form.pipeImageTag"
                class="input command-input"
                type="text"
                autocomplete="off"
                spellcheck="false"
                autocapitalize="off"
                placeholder="latest"
              />
            </div>
          </div>

          <div class="form-row-2">
            <div class="field">
              <label for="pipe-dockerfile">Dockerfile 路径</label>
              <input
                id="pipe-dockerfile"
                v-model="form.pipeDockerfilePath"
                class="input command-input"
                type="text"
                autocomplete="off"
                spellcheck="false"
                autocapitalize="off"
                :aria-invalid="errors.dockerfilePath ? 'true' : undefined"
                placeholder="src/Host/Dockerfile"
              />
              <span v-if="errors.dockerfilePath" class="field-error">{{ errors.dockerfilePath }}</span>
            </div>
            <div class="field">
              <label for="pipe-context">构建上下文</label>
              <input
                id="pipe-context"
                v-model="form.pipeBuildContext"
                class="input command-input"
                type="text"
                autocomplete="off"
                spellcheck="false"
                autocapitalize="off"
                placeholder="."
              />
            </div>
          </div>

          <div class="field pipe-checks">
            <label class="checkbox-label">
              <input type="checkbox" v-model="form.pipeGitPull" />
              <span>构建前拉取代码 (git pull)</span>
            </label>
            <label class="checkbox-label">
              <input type="checkbox" v-model="form.pipeExportTar" />
              <span>导出镜像 .tar 文件 (via WSL)</span>
            </label>
          </div>

          <div v-if="form.pipeExportTar" class="field">
            <label for="pipe-save-dir">导出目录</label>
            <div class="dir-row">
              <input
                id="pipe-save-dir"
                v-model="form.pipeSaveDir"
                class="input"
                type="text"
                autocomplete="off"
                spellcheck="false"
                autocapitalize="off"
                :placeholder="defaults.saveDir ? `继承项目默认(${defaults.saveDir})` : '请填写导出目录'"
              />
              <button type="button" class="btn-secondary browse-btn" aria-label="浏览选择导出目录" @click="browseDir('pipeSaveDir')">
                <FolderOpen />浏览…
              </button>
            </div>
          </div>

          <div class="field">
            <label for="pipe-wsl-distro">WSL 发行版</label>
            <input
              id="pipe-wsl-distro"
              v-model="form.pipeWslDistro"
              class="input"
              type="text"
              autocomplete="off"
              spellcheck="false"
              autocapitalize="off"
              :placeholder="defaults.wslDistro ? `继承项目默认(${defaults.wslDistro})` : '留空使用系统默认'"
            />
          </div>
        </template>

        <template v-else-if="kind === 'command' || kind === 'infra'">
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
            <label for="command-stop-cmd">停止命令</label>
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
.modal {
  width: min(580px, calc(100vw - 48px));
}
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
  padding: 6px 8px;
  font-size: 0.85rem;
  white-space: nowrap;
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
.form-row-2 {
  display: grid;
  grid-template-columns: 7fr 3fr;
  gap: var(--space-md);
}
.pipe-checks {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-lg);
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
