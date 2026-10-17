<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";

const props = defineProps({
  x: { type: Number, required: true },
  y: { type: Number, required: true },
  items: { type: Array, required: true },
});

const emit = defineEmits(["close"]);
const menuRef = ref(null);
const adjustedPos = ref({ x: props.x, y: props.y });

function updatePosition() {
  if (!menuRef.value) return;
  const rect = menuRef.value.getBoundingClientRect();
  const pad = 8;
  let nx = props.x;
  let ny = props.y;

  if (nx + rect.width > window.innerWidth - pad) {
    nx = Math.max(pad, window.innerWidth - rect.width - pad);
  }
  if (ny + rect.height > window.innerHeight - pad) {
    ny = Math.max(pad, window.innerHeight - rect.height - pad);
  }

  adjustedPos.value = { x: nx, y: ny };
}

function onItemClick(item) {
  if (item.disabled || item.divider) return;
  emit("close");
  if (typeof item.action === "function") {
    item.action();
  }
}

function onWindowPointerDown(e) {
  if (menuRef.value && !menuRef.value.contains(e.target)) {
    emit("close");
  }
}

function onWindowKeyDown(e) {
  if (e.key === "Escape") {
    emit("close");
  }
}

onMounted(() => {
  nextTick(updatePosition);
  window.addEventListener("pointerdown", onWindowPointerDown, true);
  window.addEventListener("contextmenu", onWindowPointerDown, true);
  window.addEventListener("keydown", onWindowKeyDown);
  window.addEventListener("resize", () => emit("close"));
});

onBeforeUnmount(() => {
  window.removeEventListener("pointerdown", onWindowPointerDown, true);
  window.removeEventListener("contextmenu", onWindowPointerDown, true);
  window.removeEventListener("keydown", onWindowKeyDown);
});
</script>

<template>
  <div
    ref="menuRef"
    class="context-menu"
    :style="{ left: `${adjustedPos.x}px`, top: `${adjustedPos.y}px` }"
    @click.stop
    @contextmenu.prevent.stop
  >
    <template v-for="(item, idx) in items" :key="idx">
      <div v-if="item.divider" class="menu-divider" />
      <button
        v-else
        type="button"
        class="menu-item"
        :class="{ 'is-danger': item.danger, 'is-disabled': item.disabled }"
        :disabled="item.disabled"
        @click="onItemClick(item)"
      >
        <component :is="item.icon" v-if="item.icon" class="item-icon" />
        <span class="item-label">{{ item.label }}</span>
        <span v-if="item.badge" class="item-badge">{{ item.badge }}</span>
      </button>
    </template>
  </div>
</template>

<style scoped>
.context-menu {
  position: fixed;
  z-index: 9999;
  min-width: 170px;
  max-width: 260px;
  padding: 4px;
  background: var(--glass-panel-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05);
  display: flex;
  flex-direction: column;
  gap: 1px;
  user-select: none;
  animation: menu-appear var(--dur-fast) var(--ease);
}

@keyframes menu-appear {
  from {
    opacity: 0;
    transform: scale(0.96) translateY(-2px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

.menu-divider {
  height: 1px;
  background: var(--color-divider);
  margin: 3px 2px;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border: none;
  background: transparent;
  color: var(--color-foreground);
  font-size: 0.8462rem;
  border-radius: var(--radius-sm);
  cursor: pointer;
  width: 100%;
  text-align: left;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}

.menu-item:hover:not(:disabled) {
  background: var(--overlay-hover);
  color: var(--color-foreground);
}

.menu-item.is-danger {
  color: var(--color-destructive);
}
.menu-item.is-danger:hover:not(:disabled) {
  background: var(--color-destructive-soft-bg);
}

.menu-item.is-disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.item-icon {
  width: 13px;
  height: 13px;
  flex: none;
  color: var(--color-muted-foreground);
}

.menu-item:hover:not(:disabled) .item-icon {
  color: var(--color-foreground);
}
.menu-item.is-danger .item-icon {
  color: var(--color-destructive);
}

.item-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-badge {
  font-size: 0.75rem;
  color: var(--color-muted-foreground);
  font-family: var(--font-mono);
}
</style>
