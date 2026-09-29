<script setup>
// 状态徽章:文字 + 色点(8px)+ 语义边框,状态不只靠颜色表达
defineProps({
  state: { type: String, default: "stopped" }, // running | stopped | error
  label: { type: String, required: true },
});
</script>

<template>
  <span class="badge" :class="`badge-${state}`">
    <span class="dot" aria-hidden="true"></span>{{ label }}
  </span>
</template>
