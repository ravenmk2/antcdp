<script setup lang="ts">
import { ElMessage } from "element-plus";
import UiIcon from "../../shared/UiIcon.vue";
const props = defineProps<{ code: string }>();
async function copy() {
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
    ElMessage.success("编码已复制");
  } catch { ElMessage.error("无法复制，请选中编码手动复制"); }
}
</script>
<template>
  <div class="connection-code"><span>编码</span><code :title="code" tabindex="0">{{ code }}</code><button class="copy-code" :aria-label="`复制编码 ${code}`" title="复制编码" @click="copy"><UiIcon name="copy" /></button></div>
</template>
