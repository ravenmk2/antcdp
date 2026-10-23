<script setup lang="ts">
import { useAppearance, type Appearance } from "./appearance";
import UiIcon from "./UiIcon.vue";
const { preference, setAppearance } = useAppearance();
function change(event: Event) {
  setAppearance((event.target as HTMLSelectElement).value as Appearance);
}
</script>

<template>
  <label class="appearance-select">
    <UiIcon :name="preference === 'system' ? 'device' : preference === 'dark' ? 'moon' : 'sun'" />
    <span class="sr-only">外观主题</span>
    <select aria-label="外观主题" :value="preference" @change="change">
      <option value="system">跟随系统</option>
      <option value="light">浅色</option>
      <option value="dark">深色</option>
    </select>
  </label>
</template>
