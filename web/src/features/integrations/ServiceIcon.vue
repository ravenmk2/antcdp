<script setup lang="ts">
import { computed } from "vue";
const props = defineProps<{ type: string }>();
const icons: Record<string, string> = { gitlab: "gitlab", jenkins: "jenkins", mysql: "mysql", postgres: "postgresql", postgresql: "postgresql", redis: "redis", rabbitmq: "rabbitmq", mongodb: "mongodb", elasticsearch: "elasticsearch", es: "elasticsearch", openobserve: "openobserve", nacos: "nacos" };
const icon = computed(() => icons[props.type]);
</script>
<template>
  <span class="integration-service-icon" aria-hidden="true">
    <img v-if="icon === 'openobserve' || icon === 'nacos'" :src="`/service-icons/${icon}.${icon === 'nacos' ? 'ico' : 'svg'}`" alt="" />
    <span v-else-if="icon" class="service-mark" :class="icon" :style="{ '--service-icon': `url('/service-icons/${icon}.svg')` }" />
    <span v-else>◎</span>
  </span>
</template>
