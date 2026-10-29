<script setup lang="ts">
import { icons, iconStrokeWidth, type IconName } from "./icons";

defineProps<{ name: IconName }>();
</script>

<template>
  <component
    :is="icons[name]"
    class="ui-icon"
    :stroke-width="iconStrokeWidth"
    aria-hidden="true"
    focusable="false"
  />
</template>
