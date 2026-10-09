<script setup>
// 方案编辑 - 分组节点:支持折叠、三态勾选全组、递归嵌套子分组与直属项目
import { computed, inject } from "vue";
import { ChevronDown, ChevronRight, Folder, FolderOpen } from "lucide-vue-next";
import ScenarioGroupNode from "./ScenarioGroupNode.vue";
import ScenarioProjectNode from "./ScenarioProjectNode.vue";

defineOptions({ name: "ScenarioGroupNode" });

const props = defineProps({
  group: { type: Object, required: true },
  depth: { type: Number, default: 0 },
});

const ctx = inject("scenarioContext");

const isCollapsed = computed(() => ctx.isGroupCollapsed(props.group.id));
const isChecked = computed(() => ctx.isGroupChecked(props.group));
const isIndeterminate = computed(() => ctx.isGroupIndeterminate(props.group));

const selectedCount = computed(() => ctx.getGroupSelectedCount(props.group));
const totalCount = computed(() => ctx.getGroupTotalCount(props.group));

function toggleCollapse() {
  ctx.toggleGroupCollapse(props.group.id);
}

function onHeaderCheckboxClick(e) {
  e.stopPropagation();
  ctx.toggleGroup(props.group);
}
</script>

<template>
  <div v-show="ctx.isGroupVisible(group)" class="group-tree-wrap">
    <!-- 分组标题行 -->
    <div class="group-row" @click="toggleCollapse">
      <button
        type="button"
        class="toggle-btn"
        :aria-label="isCollapsed ? '展开分组' : '折叠分组'"
        @click.stop="toggleCollapse"
      >
        <ChevronDown v-if="!isCollapsed" class="chevron-icon" />
        <ChevronRight v-else class="chevron-icon" />
      </button>

      <label class="checkbox-wrap" @click.stop>
        <input
          type="checkbox"
          :checked="isChecked"
          :indeterminate="isIndeterminate"
          @click="onHeaderCheckboxClick"
        />
      </label>

      <FolderOpen v-if="!isCollapsed" class="group-icon" />
      <Folder v-else class="group-icon" />

      <span class="group-title">{{ group.name }}</span>

      <span class="count-badge">
        {{ selectedCount }}/{{ totalCount }}
      </span>
    </div>

    <!-- 分组子项内容:树缩进无边框 -->
    <div v-show="!isCollapsed" class="group-children">
      <!-- 递归子分组 -->
      <ScenarioGroupNode
        v-for="sub in group.groups ?? []"
        :key="sub.id"
        :group="sub"
        :depth="depth + 1"
      />

      <!-- 直属项目 -->
      <ScenarioProjectNode
        v-for="p in group.projects ?? []"
        :key="p.id"
        :project="p"
      />
    </div>
  </div>
</template>

<style scoped>
.group-tree-wrap {
  display: flex;
  flex-direction: column;
}

.group-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  user-select: none;
  transition: background var(--dur-fast) var(--ease);
}
.group-row:hover {
  background: rgba(236, 239, 244, 0.07);
}

.toggle-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: var(--color-muted-foreground);
  padding: 2px;
  cursor: pointer;
  border-radius: var(--radius-sm);
}
.toggle-btn:hover {
  color: var(--color-foreground);
  background: var(--overlay-hover);
}
.chevron-icon {
  width: 14px;
  height: 14px;
}

.checkbox-wrap {
  display: inline-flex;
  align-items: center;
  cursor: pointer;
}
.checkbox-wrap input[type="checkbox"] {
  width: 15px;
  height: 15px;
  accent-color: var(--color-accent);
  cursor: pointer;
  margin: 0;
}

.group-icon {
  width: 15px;
  height: 15px;
  color: var(--nord-8);
  flex: none;
}

.group-title {
  font-weight: 600;
  font-size: 0.9231rem;
  color: var(--color-foreground);
}

.count-badge {
  margin-left: auto;
  font-size: 0.77rem;
  font-variant-numeric: tabular-nums;
  color: var(--color-muted-foreground);
  background: rgba(0, 0, 0, 0.2);
  padding: 1px 7px;
  border-radius: 10px;
}

.group-children {
  margin-left: 14px;
  border-left: 1px solid rgba(236, 239, 244, 0.12);
  padding-left: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
</style>
