<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import { ElButton } from "element-plus";
import UiIcon from "./UiIcon.vue";
const props = withDefaults(defineProps<{ loading?: boolean; disabled?: boolean }>(), {
  loading: false,
  disabled: false,
});
const emit = defineEmits<{ click: [event: MouseEvent] }>();
const spinning = ref(false);
const cycleMs = 600;
let startedAt = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
function start() {
  clearTimeout(timer);
  startedAt = performance.now();
  spinning.value = true;
}
function finish() {
  clearTimeout(timer);
  // Complete at least one visible turn without delaying the data response.
  timer = setTimeout(() => {
    if (!props.loading) spinning.value = false;
  }, Math.max(0, cycleMs - (performance.now() - startedAt)));
}
async function refresh(event: MouseEvent) {
  if (props.disabled || props.loading) return;
  start();
  emit("click", event);
  await nextTick();
  if (!props.loading) finish();
}
watch(() => props.loading, value => {
  // Passive loads only control availability; clicking starts the animation.
  if (!spinning.value) return;
  if (value) clearTimeout(timer);
  else finish();
});
onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <ElButton
    class="refresh-button"
    :disabled="disabled || loading"
    :aria-busy="loading"
    @click="refresh"
  >
    <UiIcon name="refresh" :class="{ 'refresh-spinning': spinning }" />
    <slot>刷新</slot>
  </ElButton>
</template>

<style scoped>
.refresh-button .ui-icon {
  flex-shrink: 0;
  transform-origin: center;
}
.refresh-spinning {
  animation: refresh-spin 0.6s linear infinite !important;
}
@keyframes refresh-spin {
  to { transform: rotate(360deg); }
}
</style>
