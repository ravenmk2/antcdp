<script setup lang="ts">
import { ref, watch, onUnmounted } from "vue";
import { ElMessage } from "element-plus";
import UiIcon from "../../shared/UiIcon.vue";
const props = defineProps<{ code: string }>();
const copied = ref(false), copying = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;
let generation = 0;
function reset() {
  generation++;
  clearTimeout(timer);
  copied.value = false;
  copying.value = false;
}
watch(() => props.code, reset);
onUnmounted(reset);
async function copy() {
  if (copying.value) return;
  copying.value = true;
  const requestGeneration = generation;

  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  try {
    if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(props.code);
    else {
      const input = document.createElement("textarea");
      input.value = props.code; input.style.position = "fixed"; input.style.opacity = "0";
      document.body.appendChild(input);
      try { input.select(); if (!document.execCommand("copy")) throw new Error("复制失败"); }
      finally { input.remove(); focused?.focus(); }
    }
    if (requestGeneration !== generation) return;
    copied.value = true;
    clearTimeout(timer);
    timer = setTimeout(() => { copied.value = false; }, 2000);
  } catch {
    if (requestGeneration !== generation) return;
    copied.value = false;
    clearTimeout(timer);
    ElMessage.error("无法复制，请选中编码手动复制");
  } finally {
    if (requestGeneration === generation) copying.value = false;
  }
}
</script>
<template>
  <div class="connection-code"><code :title="code" tabindex="0">{{ code }}</code><button type="button" class="copy-code" :class="{ copied }" :disabled="copying" :aria-label="copied ? `已复制编码 ${code}` : `复制编码 ${code}`" :title="copied ? '已复制' : '复制编码'" @click="copy"><UiIcon :name="copied ? 'check' : 'copy'" /></button></div>
</template>
