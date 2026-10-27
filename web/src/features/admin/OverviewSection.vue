<script setup lang="ts">
defineProps<{ title: string }>();
</script>
<template>
  <section class="overview-section" :aria-label="title">
    <header class="overview-section-heading">
      <h2>{{ title }}</h2>
      <slot name="actions" />
    </header>
    <slot />
  </section>
</template>
<style scoped>
.overview-section { min-width: 0; overflow: hidden; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); }
.overview-section-heading { min-height: 64px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; padding: 16px 20px; border-bottom: 1px solid var(--border); }
.overview-section-heading h2 { margin: 0; font-size: 16px; font-weight: 600; color: var(--text-primary); }
@media (max-width: 600px) { .overview-section-heading { padding: 16px; } }
</style>
