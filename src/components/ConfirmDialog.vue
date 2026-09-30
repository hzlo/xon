<script setup>
// 应用内确认对话框:替代 window.confirm(Tauri 下脚本对话框不可靠)。
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { confirmState, settleConfirm } from "../stores/app.js";

const confirmBtn = ref(null);

function onKeydown(e) {
  if (!confirmState.value) return;
  if (e.key === "Escape") settleConfirm(false);
  else if (e.key === "Enter") settleConfirm(true);
}
onMounted(() => {
  window.addEventListener("keydown", onKeydown, true);
  nextTick(() => confirmBtn.value?.focus());
});
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown, true));
</script>

<template>
  <div v-if="confirmState" class="modal-overlay confirm-overlay" @click.self="settleConfirm(false)">
    <div class="modal confirm-modal" role="alertdialog" aria-modal="true" :aria-label="confirmState.title">
      <h2 class="confirm-title">{{ confirmState.title }}</h2>
      <p class="confirm-message">{{ confirmState.message }}</p>
      <div class="confirm-actions">
        <button class="btn-secondary" @click="settleConfirm(false)">取消</button>
        <button
          ref="confirmBtn"
          :class="confirmState.danger ? 'btn-danger' : 'btn-primary'"
          @click="settleConfirm(true)"
        >
          确定
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.confirm-overlay {
  z-index: 80;
}
.confirm-modal {
  width: min(420px, calc(100vw - 48px));
  padding: var(--space-xl);
}
.confirm-title {
  margin: 0 0 var(--space-md);
  font-size: 1.0769rem;
  font-weight: 600;
}
.confirm-message {
  margin: 0;
  font-size: 1rem;
  line-height: 1.6;
  color: var(--color-muted-foreground);
  white-space: pre-line;
}
.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-md);
  margin-top: var(--space-xl);
}
</style>
