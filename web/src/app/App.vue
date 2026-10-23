<script setup lang="ts">
import { ElConfigProvider } from "element-plus";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import { useRoute } from "vue-router";
import AppearanceSelect from "../shared/AppearanceSelect.vue";
const route = useRoute();
</script>

<template>
  <ElConfigProvider :locale="zhCn">
    <div v-if="['/setup', '/login', '/register'].includes(route.path)" class="public-appearance">
      <AppearanceSelect />
    </div>
    <RouterView />
  </ElConfigProvider>
</template>
