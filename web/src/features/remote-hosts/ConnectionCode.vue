<script setup lang="ts">
import CopyableCode from "../../shared/CopyableCode.vue";
defineProps<{ code: string }>();
</script>

<template>
  <CopyableCode class="host-connection-code" :code="code" />
</template>
