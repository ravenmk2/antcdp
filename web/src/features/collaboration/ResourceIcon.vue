<script setup lang="ts">
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
const paths: Record<string, string> = {
  folder: "M3 6h6l2 2h10v12H3V6Z",
  code: "m8 7-5 5 5 5m8-10 5 5-5 5m-3-14-2 18",
  box: "m12 3 9 5v9l-9 5-9-5V8l9-5Zm0 9 9-4M3 8l9 4v10",
  globe:
    "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3a18 18 0 0 1 0 18 18 18 0 0 1 0-18Z",
  bolt: "m14 2-11 12h8l-1 8 11-13h-8l1-7Z",
  layers: "m12 3 10 5-10 5L2 8l10-5ZM2 12l10 5 10-5M2 16l10 5 10-5",
  team: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M9 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm8 .13a4 4 0 0 1 0 7.75",
};
</script>
<template>
  <span
    class="resource-icon"
    :class="{ 'resource-icon-tile': tile, 'has-image': !!fileId || !!imageUrl }"
    ><img
      v-if="fileId || imageUrl"
      :src="imageUrl || `/api/v1/icons/${fileId}`"
      alt="" /><svg
      v-else
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path :d="paths[iconKey || fallback] || paths.folder" /></svg
  ></span>
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
