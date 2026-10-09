<script setup>
// 字体选择组合框:输入过滤 + 自绘下拉。
// 不用原生 datalist:WebView2 的弹层不受 color-scheme/CSS 控制,深色主题下是白底黑字。
// 面板 fixed 定位锚住输入框(弹框 overflow:auto 会裁剪 absolute 子元素),滚动/缩放时跟随。
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";

const props = defineProps({
  id: { type: String, required: true },
  fonts: { type: Array, required: true },
  placeholder: { type: String, default: "" },
  modelValue: { type: String, default: "" },
});
const emit = defineEmits(["update:modelValue"]);

const open = ref(false);
const active = ref(0);
const rootEl = ref(null);
const inputEl = ref(null);
const panelStyle = ref({});
const arrowOpen = ref(false);

// 过滤跟随输入文本:与原生 datalist 一致,清空输入即看全部
const filtered = computed(() => {
  const q = props.modelValue.trim().toLowerCase();
  if (!q) return props.fonts;
  return props.fonts.filter((f) => f.toLowerCase().includes(q));
});

watch(filtered, () => {
  active.value = 0;
  if (open.value) nextTick(scrollActive);
});

function scrollActive() {
  document
    .getElementById(`${props.id}-opt-${active.value}`)
    ?.scrollIntoView({ block: "nearest" });
}

function place() {
  const el = inputEl.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  const below = window.innerHeight - r.bottom;
  // 下方放不下且上方更宽裕时向上展开
  if (below < 140 && r.top > below) {
    panelStyle.value = {
      left: `${r.left}px`,
      bottom: `${window.innerHeight - r.top + 4}px`,
      width: `${r.width}px`,
      maxHeight: `${Math.min(264, r.top - 12)}px`,
    };
  } else {
    panelStyle.value = {
      left: `${r.left}px`,
      top: `${r.bottom + 4}px`,
      width: `${r.width}px`,
      maxHeight: `${Math.min(264, Math.max(120, below - 8))}px`,
    };
  }
}

function onDocPointerdown(e) {
  if (!rootEl.value.contains(e.target)) close();
}
function onReflow() {
  if (open.value) place();
}

function openPanel() {
  if (open.value) return;
  open.value = true;
  arrowOpen.value = true;
  active.value = Math.max(0, filtered.value.findIndex((f) => f === props.modelValue));
  place();
  nextTick(scrollActive);
  document.addEventListener("pointerdown", onDocPointerdown, true);
  document.addEventListener("scroll", onReflow, true);
  window.addEventListener("resize", onReflow);
}
function close() {
  if (!open.value) return;
  open.value = false;
  arrowOpen.value = false;
  document.removeEventListener("pointerdown", onDocPointerdown, true);
  document.removeEventListener("scroll", onReflow, true);
  window.removeEventListener("resize", onReflow);
}

function select(f) {
  emit("update:modelValue", f);
  close();
  inputEl.value?.focus();
}

function onKeydown(e) {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (!open.value) {
      openPanel();
      return;
    }
    const n = filtered.value.length;
    if (!n) return;
    active.value = (active.value + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
    nextTick(scrollActive);
  } else if (e.key === "Enter") {
    if (!open.value) return; // 关闭时交给表单提交
    e.preventDefault();
    const f = filtered.value[active.value];
    if (f) select(f);
    else close();
  } else if (e.key === "Escape") {
    if (!open.value) return; // 关闭时让外层弹框处理
    e.preventDefault();
    e.stopPropagation();
    close();
  } else if (e.key === "Tab") {
    close();
  }
}

onBeforeUnmount(close);
</script>

<template>
  <div ref="rootEl" class="fp">
    <input
      :id="id"
      ref="inputEl"
      class="input fp-input"
      type="text"
      role="combobox"
      :value="modelValue"
      :placeholder="placeholder"
      autocomplete="off"
      spellcheck="false"
      aria-autocomplete="list"
      :aria-expanded="open"
      :aria-controls="open ? `${id}-listbox` : undefined"
      :aria-activedescendant="open && filtered[active] ? `${id}-opt-${active}` : undefined"
      @input="emit('update:modelValue', $event.target.value)"
      @focus="openPanel"
      @keydown="onKeydown"
    />
    <button
      type="button"
      class="fp-arrow"
      :class="{ open: arrowOpen }"
      tabindex="-1"
      aria-label="展开字体列表"
      @mousedown.prevent
      @click="open ? close() : openPanel()"
    >
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 6l4 4 4-4" />
      </svg>
    </button>

    <ul
      v-if="open"
      :id="`${id}-listbox`"
      class="fp-panel"
      role="listbox"
      :aria-label="`${id} 字体列表`"
      :style="panelStyle"
    >
      <li
        v-for="(f, i) in filtered"
        :key="f"
        :id="`${id}-opt-${i}`"
        class="fp-opt"
        role="option"
        :aria-selected="f === modelValue"
        :class="{ active: i === active }"
        @mousedown.prevent
        @mousemove="active = i"
        @click="select(f)"
      >
        <span class="fp-name">{{ f }}</span>
        <span class="fp-sample" :style="{ fontFamily: `'${f}'` }">Aa 字 123</span>
      </li>
      <li v-if="!filtered.length" class="fp-empty">无匹配字体</li>
    </ul>
  </div>
</template>

<style scoped>
.fp {
  position: relative;
}
.fp-input {
  padding-right: 28px;
}
.fp-arrow {
  position: absolute;
  right: 5px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  padding: 3px;
  border: none;
  background: none;
  color: var(--color-muted-foreground);
  cursor: pointer;
  border-radius: var(--radius-sm);
}
.fp-arrow svg {
  width: 14px;
  height: 14px;
  display: block;
  transition: transform var(--dur-fast) var(--ease);
}
.fp-arrow.open svg {
  transform: rotate(180deg);
}
.fp-panel {
  position: fixed;
  z-index: 80;
  margin: 0;
  padding: 4px;
  list-style: none;
  background: var(--glass-panel-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  box-shadow: var(--glass-highlight), var(--shadow-lg);
  overflow-y: auto;
  overscroll-behavior: contain;
}
.fp-opt {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-lg);
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease);
}
.fp-opt:hover,
.fp-opt.active {
  background: var(--overlay-hover);
}
.fp-opt[aria-selected="true"] {
  background: var(--overlay-selected);
  box-shadow: inset 2px 0 0 var(--color-accent);
}
.fp-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fp-sample {
  flex: none;
  color: var(--color-muted-foreground);
  font-size: 0.9231rem;
}
.fp-empty {
  padding: 8px;
  color: var(--color-muted-foreground);
  text-align: center;
}
</style>
