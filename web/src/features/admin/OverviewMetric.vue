<script setup lang="ts">
import { RouterLink } from "vue-router";
import UiIcon from "../../shared/UiIcon.vue";
defineProps<{
  label: string;
  value: number;
  hint: string;
  icon: "users" | "user" | "block" | "shield";
  to?: string;
}>();
</script>
<template>
  <component :is="to ? RouterLink : 'div'" :to="to" class="overview-metric" :class="{ linked: to }">
    <div class="metric-label"><span>{{ label }}</span><UiIcon :name="icon" /></div>
    <strong class="metric-value">{{ value.toLocaleString('zh-CN') }}</strong>
    <div class="metric-hint"><span>{{ hint }}</span><UiIcon v-if="to" name="arrow" /></div>
  </component>
</template>
<style scoped>
.overview-metric {
  min-width: 0;
  display: grid;
  gap: 12px;
  padding: 20px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
}
.overview-metric.linked:hover { border-color: var(--border-control); background: var(--surface-subtle); }
.metric-label, .metric-hint { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.metric-label { color: var(--text-secondary); font-size: 14px; }
.metric-label .ui-icon { color: var(--text-muted); width: 18px; height: 18px; }
.metric-value { font-size: 32px; font-weight: 600; line-height: 1.2; font-variant-numeric: tabular-nums; color: var(--text-primary); }
.metric-hint { color: var(--text-muted); font-size: 13px; }
.metric-hint .ui-icon { width: 15px; height: 15px; }
@media (max-width: 600px) {
  .overview-metric { padding: 16px; gap: 10px; }
  .metric-value { font-size: 28px; }
}
</style>
