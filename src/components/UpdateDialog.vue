<script setup>
import { ref } from "vue";
import { Download, RefreshCw, X, CheckCircle, AlertCircle } from "lucide-vue-next";
import { installUpdate } from "../updater.js";

const props = defineProps({
  /** @type {import("@tauri-apps/plugin-updater").Update} */
  update: { type: Object, required: true },
  currentVersion: { type: String, default: "0.1.0" },
});
const emit = defineEmits(["close"]);

const installing = ref(false);
const progressPercent = ref(0);
const statusText = ref("");
const errorMsg = ref("");

async function startInstall() {
  installing.value = true;
  errorMsg.value = "";
  statusText.value = "正在连接并下载更新包...";

  try {
    await installUpdate(props.update, (p) => {
      if (p.state === "started") {
        statusText.value = "正在下载更新...";
        progressPercent.value = 0;
      } else if (p.state === "progress") {
        progressPercent.value = p.percent ?? 0;
        statusText.value = `正在下载更新: ${p.percent}%`;
      } else if (p.state === "finished") {
        progressPercent.value = 100;
        statusText.value = "下载完成，正在重启应用...";
      }
    });
  } catch (err) {
    installing.value = false;
    errorMsg.value = err?.message || "下载更新失败，请稍后重试";
    statusText.value = "";
  }
}
</script>

<template>
  <div class="modal-overlay">
    <div class="modal update-modal" role="dialog" aria-modal="true" aria-label="软件更新">
      <div class="update-header">
        <div class="title-with-badge">
          <h2 class="modal-title">发现新版本</h2>
          <span class="version-tag new-tag">v{{ update.version }}</span>
        </div>
        <button
          v-if="!installing"
          class="btn-icon close-btn"
          title="稍后"
          @click="emit('close')"
        >
          <X :size="16" />
        </button>
      </div>

      <div class="version-comparison">
        <span class="curr-ver">当前版本: v{{ currentVersion }}</span>
        <span class="arrow">➔</span>
        <span class="target-ver">目标版本: v{{ update.version }}</span>
      </div>

      <!-- 更新日志说明 -->
      <div v-if="update.body" class="changelog-container">
        <div class="changelog-label">更新内容：</div>
        <pre class="changelog-body">{{ update.body }}</pre>
      </div>
      <div v-else class="changelog-container changelog-empty">
        <p>此版本包含性能优化与已知问题修复。</p>
      </div>

      <!-- 进度条与状态 -->
      <div v-if="installing" class="progress-section">
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" :style="{ width: `${progressPercent}%` }"></div>
        </div>
        <div class="status-row">
          <RefreshCw :size="13" class="spin-icon" />
          <span class="status-text">{{ statusText }}</span>
        </div>
      </div>

      <!-- 报错提示 -->
      <div v-if="errorMsg" class="error-banner">
        <AlertCircle :size="14" />
        <span>{{ errorMsg }}</span>
      </div>

      <!-- 操作按钮 -->
      <div class="modal-actions">
        <button
          v-if="!installing"
          type="button"
          class="btn-secondary"
          @click="emit('close')"
        >
          稍后提醒
        </button>
        <button
          type="button"
          class="btn-primary"
          :disabled="installing"
          @click="startInstall"
        >
          <Download v-if="!installing" :size="14" />
          <RefreshCw v-else :size="14" class="spin-icon" />
          <span>{{ installing ? '正在更新...' : '立即更新并重启' }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.update-modal {
  width: min(500px, calc(100vw - 48px));
  border: 1px solid var(--color-border);
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45);
}
.update-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-md);
}
.title-with-badge {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}
.modal-title {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 600;
  color: var(--color-foreground);
}
.version-tag {
  font-size: 0.75rem;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 999px;
}
.new-tag {
  background: rgba(163, 190, 140, 0.18);
  color: #a3be8c;
  border: 1px solid rgba(163, 190, 140, 0.35);
}
.close-btn {
  padding: 4px;
  color: var(--color-muted-foreground);
}
.version-comparison {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  font-size: 0.8125rem;
  color: var(--color-muted-foreground);
  margin-bottom: var(--space-md);
}
.arrow {
  color: var(--accent);
}
.target-ver {
  color: var(--color-foreground);
  font-weight: 600;
}
.changelog-container {
  max-height: 180px;
  overflow-y: auto;
  background: var(--color-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-md);
  margin-bottom: var(--space-lg);
}
.changelog-label {
  font-size: 0.75rem;
  color: var(--color-muted-foreground);
  margin-bottom: 4px;
}
.changelog-body {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  font-size: 0.8125rem;
  line-height: 1.5;
  color: var(--color-foreground);
}
.changelog-empty {
  color: var(--color-muted-foreground);
  font-size: 0.8125rem;
}
.progress-section {
  margin-bottom: var(--space-md);
}
.progress-bar-bg {
  width: 100%;
  height: 6px;
  background: var(--color-muted);
  border-radius: 999px;
  overflow: hidden;
  margin-bottom: var(--space-xs);
}
.progress-bar-fill {
  height: 100%;
  background: var(--accent);
  transition: width 0.2s ease;
}
.status-row {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  font-size: 0.75rem;
  color: var(--accent);
}
.spin-icon {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.error-banner {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  font-size: 0.75rem;
  color: #bf616a;
  background: rgba(191, 97, 106, 0.12);
  border: 1px solid rgba(191, 97, 106, 0.3);
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-md);
  margin-bottom: var(--space-md);
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-md);
}
</style>
