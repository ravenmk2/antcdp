<script setup lang="ts">
import { diagnosticText, diagnosticTone, type Diagnostic } from "./types";

defineProps<{ diagnostic: Diagnostic }>();
</script>

<template>
  <span class="diagnostic-result">
    <span v-if="diagnostic.outdated" class="diagnostic-history">历史结果 · </span><span class="diagnostic-status" :class="`diagnostic-${diagnosticTone(diagnostic)}`">{{ diagnostic.status === 'received_not_dispatched' ? '已验证接收' : diagnosticText(diagnostic) }}</span><span v-if="diagnostic.status === 'received_not_dispatched'" class="diagnostic-detail">，未分发工作流</span>
  </span>
</template>
