<script setup lang="ts">
import { icons, iconStrokeWidth } from "../../shared/icons";
withDefaults(
  defineProps<{
    iconKey?: string | null;
    fileId?: string | null;
    imageUrl?: string | null;
    fallback?: string;
    tile?: boolean;
  }>(),
  { fallback: "folder" },
);
const resourceIcons = {
  folder: icons.folder,
  code: icons.code,
  box: icons.box,
  globe: icons.globe,
  bolt: icons.bolt,
  layers: icons.layers,
  team: icons.team,
};
function resourceIcon(key: string) {
  return resourceIcons[key as keyof typeof resourceIcons] || resourceIcons.folder;
}
</script>
<template>
  <span
    class="resource-icon"
    :class="{ 'resource-icon-tile': tile, 'has-image': !!fileId || !!imageUrl }"
    ><img
      v-if="fileId || imageUrl"
      :src="imageUrl || `/api/v1/icons/${fileId}`"
      alt="" /><component
      :is="resourceIcon(iconKey || fallback)"
      v-else
      :stroke-width="iconStrokeWidth"
      aria-hidden="true"
      focusable="false"
    /></span>
</template>
<style scoped>
.resource-icon {
  display: inline-flex;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  color: var(--text-secondary);
}
.resource-icon-tile {
  width: 42px;
  height: 42px;
  align-items: center;
  justify-content: center;
  background: var(--surface-subtle);
  border-radius: 10px;
}
.resource-icon-tile svg {
  width: 23px;
  height: 23px;
}
.resource-icon-tile img {
  border-radius: inherit;
}
.resource-icon-tile.has-image {
  background: transparent;
}
svg,
img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 5px;
}
</style>
