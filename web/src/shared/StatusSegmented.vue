<script setup lang="ts">
import { useId } from "vue";
defineProps<{ modelValue: string; options: { value: string; label: string; count?: number | string }[] }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
const groupName = useId();
</script>
<template>
  <div class="status-segmented" role="group" aria-label="状态筛选">
    <label v-for="option in options" :key="option.value" class="status-segment" :class="{ selected: modelValue === option.value }">
      <input type="radio" :name="groupName" :value="option.value" :checked="modelValue === option.value" @change="emit('update:modelValue', option.value)" />
      <span>{{ option.label }}</span><span v-if="option.count !== undefined" class="segment-count">{{ option.count }}</span>
    </label>
  </div>
</template>
<style scoped>
.status-segmented { display: inline-flex; flex-shrink: 0; min-height: 40px; padding: 3px; gap: 2px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-subtle); }
.status-segment { position: relative; display: flex; align-items: center; justify-content: center; gap: 5px; padding: 4px 10px; border: 1px solid transparent; border-radius: 5px; color: var(--text-muted); font-size: 13px; white-space: nowrap; cursor: pointer; }
.status-segment:hover { color: var(--text-primary); }
.status-segment.selected { background: var(--surface); border-color: var(--border); color: var(--text-primary); box-shadow: 0 1px 2px var(--shadow-color); font-weight: 600; }
.status-segment input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.status-segment:has(input:focus-visible) { outline: 2px solid var(--focus); outline-offset: 2px; }
.segment-count { font-size: 12px; font-weight: 400; color: var(--text-muted); font-variant-numeric: tabular-nums; }
</style>
