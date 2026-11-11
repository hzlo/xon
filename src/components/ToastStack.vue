<script setup>
// 底部轻提示堆栈:替代 window.alert,自动消失。
import { toasts } from "../stores/app.js";
</script>

<template>
  <div class="toast-stack" aria-live="polite">
    <TransitionGroup name="toast">
      <div v-for="t in toasts" :key="t.id" class="toast">{{ t.text }}</div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-stack {
  position: fixed;
  left: 50%;
  bottom: var(--space-xl);
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-sm);
  z-index: 90;
  pointer-events: none;
}
.toast {
  background: var(--color-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  color: var(--color-foreground);
  font-size: 0.9231rem;
  line-height: 1.5;
  padding: 6px 14px;
  max-width: 70vw;
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity var(--dur-normal) var(--ease), transform var(--dur-normal) var(--ease);
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(6px);
}
</style>
