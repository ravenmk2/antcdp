<script setup lang="ts">
import { pageSizes } from "./pageSize";
defineProps<{ disabled?: boolean }>();
const value = defineModel<number>({ required: true });
</script>
<template>
  <select v-model.number="value" class="page-size-select" aria-label="每页数量" :disabled="disabled">
    <option v-for="size in pageSizes" :key="size" :value="size">{{ size }} 条/页</option>
  </select>
</template>
<style scoped>
.page-size-select {
  min-height: 34px;
  padding: 4px 26px 4px 10px;
  border: 1px solid var(--border-control);
  border-radius: 7px;
  background: var(--surface-input);
  color: var(--text-secondary);
  font: inherit;
  cursor: pointer;
}
.page-size-select:disabled { cursor: default; opacity: 0.6; }
</style>
