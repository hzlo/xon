<script setup>
// 设置对话框:主题(深/浅)、强调色派生、界面/日志字体(系统全量字体,可输入可下拉)、
// 界面与日志字号、关闭行为。
import { nextTick, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { listFonts } from "../api.js";
import { checkUpdate } from "../updater.js";
import { ChevronDown, RefreshCw } from "lucide-vue-next";
import FontPicker from "./FontPicker.vue";

const props = defineProps({
  /** @type {import("api.js").AppSettings} */
  initial: { type: Object, required: true },
  version: { type: String, default: "0.1.8" },
});
const emit = defineEmits(["submit", "cancel", "show-update"]);

// 检查更新状态
const checkingUpdate = ref(false);
const updateStatus = ref("");

async function onCheckUpdate() {
  checkingUpdate.value = true;
  updateStatus.value = "";
  try {
    const update = await checkUpdate();
    if (update) {
      updateStatus.value = `发现新版本 v${update.version}`;
      emit("show-update", update);
    } else {
      updateStatus.value = "当前已是最新版本";
    }
  } catch (err) {
    const msg = String(err?.message || err || "");
    if (msg.includes("404")) {
      updateStatus.value = "检查更新失败: 未找到版本文件 (404)";
    } else if (msg.includes("network") || msg.includes("Failed to fetch") || msg.includes("connect")) {
      updateStatus.value = "检查更新失败: 网络连接异常";
    } else {
      updateStatus.value = `检查更新失败: ${msg || "请稍后重试"}`;
    }
  } finally {
    checkingUpdate.value = false;
  }
}

// 系统字体列表:首次打开时枚举一次,模块级缓存
let fontCache = null;
const systemFonts = ref([]);

const form = reactive({
  theme: "dark",
  accent: props.initial.accent ?? "#88C0D0",
  uiFont: props.initial.uiFont ?? "",
  logFont: props.initial.logFont ?? "",
  logFontSize: props.initial.logFontSize ?? 12,
  uiFontSize: props.initial.uiFontSize ?? 13,
  closeAction: props.initial.closeAction ?? "minimize",
});
const accentInput = ref(null);

// 自定义关闭行为下拉菜单
const closeSelectOpen = ref(false);
const closeSelectRef = ref(null);

function selectCloseAction(val) {
  form.closeAction = val;
  closeSelectOpen.value = false;
}

function onDocPointerdown(e) {
  if (closeSelectRef.value && !closeSelectRef.value.contains(e.target)) {
    closeSelectOpen.value = false;
  }
}

function onKeydown(e) {
  if (e.key === "Escape") {
    if (closeSelectOpen.value) {
      closeSelectOpen.value = false;
      return;
    }
    emit("cancel");
  }
}

onMounted(async () => {
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("pointerdown", onDocPointerdown);
  nextTick(() => accentInput.value?.focus());
  try {
    fontCache ??= await listFonts();
    systemFonts.value = fontCache;
  } catch {
    systemFonts.value = [];
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("pointerdown", onDocPointerdown);
});

function submit() {
  emit("submit", {
    theme: "dark",
    accent: form.accent,
    uiFont: form.uiFont.trim(),
    logFont: form.logFont.trim(),
    logFontSize: Number(form.logFontSize) || 12,
    uiFontSize: Number(form.uiFontSize) || 13,
    closeAction: form.closeAction,
  });
}
</script>

<template>
  <div class="modal-overlay">
    <div class="modal" role="dialog" aria-modal="true" aria-label="设置">
      <h2 class="modal-title">设置</h2>

      <form @submit.prevent="submit">
        <div class="field-row">
          <div class="field">
            <label>主题</label>
            <div class="theme-display">
              <span>深色 (Nord)</span>
            </div>
          </div>
          <div class="field">
            <label for="set-accent">强调色</label>
            <div class="accent-row">
              <input
                id="set-accent"
                ref="accentInput"
                v-model="form.accent"
                class="accent-color"
                type="color"
              />
              <input v-model="form.accent" class="input" type="text" spellcheck="false" autocomplete="off" />
            </div>
          </div>
        </div>

        <div class="field">
          <label for="set-ui-font">界面字体</label>
          <FontPicker
            id="set-ui-font"
            v-model="form.uiFont"
            :fonts="systemFonts"
            placeholder="默认(IBM Plex Sans)"
          />
        </div>

        <div class="field-row">
          <div class="field">
            <label for="set-log-font">日志字体</label>
            <FontPicker
              id="set-log-font"
              v-model="form.logFont"
              :fonts="systemFonts"
              placeholder="默认(JetBrains Mono)"
            />
          </div>
          <div class="field field-narrow">
            <label for="set-log-size">日志字号(px)</label>
            <input
              id="set-log-size"
              v-model.number="form.logFontSize"
              class="input"
              type="number"
              min="10"
              max="18"
              step="1"
              autocomplete="off"
            />
          </div>
          <div class="field field-narrow">
            <label for="set-ui-size">界面字号(px)</label>
            <input
              id="set-ui-size"
              v-model.number="form.uiFontSize"
              class="input"
              type="number"
              min="11"
              max="18"
              step="1"
              autocomplete="off"
            />
          </div>
        </div>

        <div class="field">
          <label>点击窗口关闭按钮时</label>
          <div ref="closeSelectRef" class="custom-select" :class="{ open: closeSelectOpen }">
            <button
              type="button"
              class="custom-select-trigger"
              @click="closeSelectOpen = !closeSelectOpen"
            >
              <span>{{ form.closeAction === 'minimize' ? '最小化到托盘' : '完全退出' }}</span>
              <ChevronDown class="select-chevron" :class="{ open: closeSelectOpen }" />
            </button>
            <div v-if="closeSelectOpen" class="custom-select-menu">
              <button
                type="button"
                class="custom-select-option"
                :class="{ active: form.closeAction === 'minimize' }"
                @click="selectCloseAction('minimize')"
              >
                <span>最小化到托盘</span>
              </button>
              <button
                type="button"
                class="custom-select-option"
                :class="{ active: form.closeAction === 'exit' }"
                @click="selectCloseAction('exit')"
              >
                <span>完全退出</span>
              </button>
            </div>
          </div>
        </div>

        <!-- 软件版本与在线更新 -->
        <div class="field update-field">
          <label>关于与更新</label>
          <div class="update-card">
            <div class="update-meta">
              <span class="app-tag">XON {{ version }}</span>
              <span v-if="updateStatus" class="update-msg" :class="{ 'has-new': updateStatus.includes('新版本') }">
                {{ updateStatus }}
              </span>
            </div>
            <button
              type="button"
              class="btn-secondary btn-sm update-btn"
              :disabled="checkingUpdate"
              @click="onCheckUpdate"
            >
              <RefreshCw :size="12" :class="{ 'spin-icon': checkingUpdate }" />
              <span>{{ checkingUpdate ? '正在检查...' : '检查更新' }}</span>
            </button>
          </div>
        </div>

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
  width: min(560px, calc(100vw - 48px));
}
.modal-title {
  margin: 0 0 var(--space-xl);
  font-size: 1.0769rem;
  font-weight: 600;
}
.field-row {
  display: flex;
  gap: var(--space-lg);
  align-items: flex-end;
}
.field-row .field {
  flex: 1;
}
.field-narrow {
  flex: 0 0 96px !important;
}
.accent-row {
  display: flex;
  gap: var(--space-sm);
  align-items: center;
}
.accent-color {
  width: 34px;
  height: 28px;
  padding: 2px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--input-bg);
  cursor: pointer;
}
.theme-display {
  height: 32px;
  display: flex;
  align-items: center;
  padding: 0 var(--space-md);
  background: var(--input-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-muted-foreground);
  font-size: 0.9231rem;
  user-select: none;
}
.custom-select {
  position: relative;
  width: 100%;
}
.custom-select-trigger {
  width: 100%;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-md);
  background: var(--input-bg);
  border: 1px solid var(--input-border);
  border-radius: var(--radius-md);
  color: var(--color-foreground);
  font: inherit;
  font-size: 0.9231rem;
  cursor: pointer;
  outline: none;
  transition: border-color var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease);
}
.custom-select-trigger:focus-visible,
.custom-select.open .custom-select-trigger {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px var(--color-accent-soft-border);
}
.select-chevron {
  width: 14px;
  height: 14px;
  color: var(--color-muted-foreground);
  transition: transform var(--dur-fast) var(--ease);
}
.select-chevron.open {
  transform: rotate(180deg);
}
.custom-select-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 50;
  background: var(--nord-0);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55), 0 2px 8px rgba(0, 0, 0, 0.3);
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  animation: select-menu-in var(--dur-fast) var(--ease);
}
@keyframes select-menu-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.custom-select-option {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--color-foreground);
  font: inherit;
  font-size: 0.88rem;
  cursor: pointer;
  text-align: left;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}
.custom-select-option:hover {
  background: rgba(236, 239, 244, 0.08);
}
.custom-select-option.active {
  background: var(--overlay-selected);
  color: var(--color-accent);
  box-shadow: inset 2px 0 0 var(--color-accent);
  font-weight: 500;
}
.update-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-sm) var(--space-md);
  background: var(--color-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}
.update-meta {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}
.app-tag {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-foreground);
  background: rgba(255, 255, 255, 0.06);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
}
.update-msg {
  font-size: 0.75rem;
  color: var(--color-muted-foreground);
}
.update-msg.has-new {
  color: #a3be8c;
  font-weight: 600;
}
.update-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.spin-icon {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-md);
  margin-top: var(--space-xl);
}
</style>
