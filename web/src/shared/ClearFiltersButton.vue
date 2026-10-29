<script setup lang="ts">
import { ElButton } from "element-plus";
import UiIcon from "./UiIcon.vue";
</script>

<template>
  <ElButton class="clear-filters-button" aria-label="清除筛选" title="清除筛选">
    <UiIcon name="clear-filters" />
  </ElButton>
</template>

<style scoped>
.clear-filters-button {
  width: 40px;
  padding: 8px;
}
</style>
