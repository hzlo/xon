<script setup>
// 设置对话框:主题(深/浅)、强调色派生、界面与日志字体、日志字号、关闭行为。
import { nextTick, onBeforeUnmount, onMounted, reactive, ref } from "vue";

const props = defineProps({
  /** @type {import("api.js").AppSettings} */
  initial: { type: Object, required: true },
});
const emit = defineEmits(["submit", "cancel"]);

const UI_FONTS = ["", "IBM Plex Sans", "Segoe UI", "Microsoft YaHei"];
const LOG_FONTS = ["", "JetBrains Mono", "Cascadia Mono", "Consolas", "Courier New"];

const form = reactive({
  theme: props.initial.theme ?? "dark",
  accent: props.initial.accent ?? "#22C55E",
  uiFont: props.initial.uiFont ?? "",
  logFont: props.initial.logFont ?? "",
  logFontSize: props.initial.logFontSize ?? 12,
  closeAction: props.initial.closeAction ?? "minimize",
});
const accentInput = ref(null);

function onKeydown(e) {
  if (e.key === "Escape") emit("cancel");
}
onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  nextTick(() => accentInput.value?.focus());
});
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));

function submit() {
  emit("submit", {
    theme: form.theme,
    accent: form.accent,
    uiFont: form.uiFont,
    logFont: form.logFont,
    logFontSize: Number(form.logFontSize) || 12,
    closeAction: form.closeAction,
  });
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('cancel')">
    <div class="modal" role="dialog" aria-modal="true" aria-label="设置">
      <h2 class="modal-title">设置</h2>

      <form @submit.prevent="submit">
        <div class="field-row">
          <div class="field">
            <label for="set-theme">主题</label>
            <select id="set-theme" v-model="form.theme" class="select">
              <option value="dark">深色(默认)</option>
              <option value="light">浅色</option>
            </select>
          </div>
          <div class="field">
            <label for="set-accent">强调色(按钮/状态徽章随之派生)</label>
            <div class="accent-row">
              <input
                id="set-accent"
                ref="accentInput"
                v-model="form.accent"
                class="accent-color"
                type="color"
              />
              <input v-model="form.accent" class="input" type="text" spellcheck="false" />
            </div>
          </div>
        </div>

        <div class="field-row">
          <div class="field">
            <label for="set-ui-font">界面字体</label>
            <select id="set-ui-font" v-model="form.uiFont" class="select">
              <option v-for="f in UI_FONTS" :key="f" :value="f">{{ f || "默认(IBM Plex Sans)" }}</option>
            </select>
          </div>
          <div class="field">
            <label for="set-log-font">日志字体</label>
            <select id="set-log-font" v-model="form.logFont" class="select">
              <option v-for="f in LOG_FONTS" :key="f" :value="f">{{ f || "默认(JetBrains Mono)" }}</option>
            </select>
          </div>
          <div class="field">
            <label for="set-log-size">日志字号(px)</label>
            <input
              id="set-log-size"
              v-model.number="form.logFontSize"
              class="input"
              type="number"
              min="10"
              max="18"
              step="1"
            />
          </div>
        </div>

        <div class="field">
          <label for="set-close">点击窗口关闭按钮时</label>
          <select id="set-close" v-model="form.closeAction" class="select">
            <option value="minimize">最小化到托盘(推荐)</option>
            <option value="exit">完全退出(停止所有进程)</option>
          </select>
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
  font-size: 14px;
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
  background: var(--color-muted);
  cursor: pointer;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-md);
  margin-top: var(--space-xl);
}
</style>
