<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import AppLayout from "../../app/AppLayout.vue";
import UiIcon from "../../shared/UiIcon.vue";
import ResourceIcon from "../collaboration/ResourceIcon.vue";
import { useShortcuts } from "../collaboration/sidebar";
import { statusLabel } from "../collaboration/model";
import { useIdentity, errorMessage } from "../identity/store";
const identity = useIdentity();
const displayName = computed(() => identity.user?.display_name || identity.user?.username);
const shortcuts = useShortcuts();
const loading = ref(true);
const error = ref("");
async function load() {
  loading.value = true;
  error.value = "";
  try { await shortcuts.refresh(); }
  catch (e) { error.value = errorMessage(e); }
  finally { loading.value = false; }
}
onMounted(load);
</script>
<template>
  <AppLayout>
    <div class="home-workspace">
      <section class="home-intro" aria-label="工作区">
        <h1>欢迎回来<span v-if="displayName">，{{ displayName }}</span>。</h1>
      </section>
      <div class="home-entry-grid">
        <RouterLink to="/projects" class="home-entry">
          <span class="home-entry-icon"><ResourceIcon fallback="folder" /></span>
          <span><strong>我的项目</strong></span><UiIcon name="chevron" />
        </RouterLink>
        <RouterLink to="/teams" class="home-entry">
          <span class="home-entry-icon"><ResourceIcon fallback="team" /></span>
          <span><strong>我的团队</strong></span><UiIcon name="chevron" />
        </RouterLink>
      </div>
      <section class="home-pinned" aria-labelledby="home-pinned-title" :aria-busy="loading">
        <header><h2 id="home-pinned-title">常用协作</h2><UiIcon name="pin" /></header>
        <p v-if="loading" class="home-state" role="status">正在加载快捷方式…</p>
        <div v-else-if="error" class="home-state" role="alert"><p>{{ error }}</p><button class="btn" @click="load">重新加载</button></div>
        <template v-else-if="shortcuts.groups.projects.items.length || shortcuts.groups.teams.items.length">
          <section v-for="group in (['projects', 'teams'] as const)" :key="group" class="home-pin-group">
            <template v-if="shortcuts.groups[group].items.length">
              <h3>{{ group === 'projects' ? '项目' : '团队' }}</h3>
              <div class="home-pin-grid">
                <RouterLink v-for="item in shortcuts.groups[group].items" :key="item.id" :to="`/${group}/${item.id}`" class="home-pin">
                  <ResourceIcon :icon-key="item.icon_key" :file-id="item.icon_file_id" :fallback="group === 'projects' ? 'folder' : 'team'" tile />
                  <span><strong>{{ item.name }}</strong><small>{{ item.status === 'active' ? item.code : statusLabel(item.status) }}</small></span><UiIcon name="chevron" />
                </RouterLink>
              </div>
            </template>
          </section>
        </template>
        <div v-else class="home-empty">
          <span class="home-empty-icon"><UiIcon name="pin" /></span>
          <h3>尚未固定项目或团队</h3>
          <RouterLink to="/projects" class="btn primary">浏览我的项目 <UiIcon name="chevron" /></RouterLink>
        </div>
      </section>
    </div>
  </AppLayout>
</template>
<style scoped>
.home-workspace { max-width: 1120px; margin: 0 auto; }
.home-intro { display: flex; justify-content: space-between; align-items: center; gap: 24px; padding: 12px 0 28px; }
.home-intro h1 { font-size: 28px; line-height: 1.4; margin: 0; font-weight: 600; overflow-wrap: anywhere; }
.home-entry-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-bottom: 32px; }
.home-entry { display: flex; align-items: center; gap: 16px; padding: 24px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); }
.home-entry > span:nth-child(2), .home-pin > span:nth-child(2) { flex: 1; min-width: 0; }
.home-entry strong, .home-pin strong, .home-pin small { display: block; overflow-wrap: anywhere; }
.home-entry strong { font-size: 18px; font-weight: 600; }
.home-entry-icon, .home-empty-icon { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 10px; background: var(--surface-subtle); flex-shrink: 0; }
.home-entry > .ui-icon, .home-pin > .ui-icon { color: var(--text-muted); width: 16px; }
.home-entry:hover, .home-pin:hover { background: var(--surface-subtle); border-color: var(--border-control); }
.home-pinned > header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-bottom: 18px; border-bottom: 1px solid var(--border); }
.home-pinned h2 { font-size: 18px; margin: 0; font-weight: 600; }
.home-pinned header > .ui-icon { color: var(--text-muted); }
.home-state { padding: 36px 0; color: var(--text-muted); }
.home-empty { padding: 40px 24px; text-align: center; }
.home-empty-icon { margin: 0 auto 16px; color: var(--text-muted); }
.home-empty h3 { font-size: 17px; font-weight: 500; margin: 0 0 20px; }
.home-pin-group h3 { font-size: 13px; color: var(--text-muted); font-weight: 500; margin: 20px 0 10px; }
.home-pin-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.home-pin { display: flex; align-items: center; gap: 12px; padding: 16px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
.home-pin strong { font-size: 15px; font-weight: 500; }
.home-pin small { font-size: 13px; color: var(--text-muted); margin-top: 2px; }
@media (max-width: 600px) { .home-intro { align-items: flex-start; flex-direction: column; gap: 12px; } .home-intro h1 { font-size: 24px; } .home-entry-grid, .home-pin-grid { grid-template-columns: 1fr; } .home-entry { padding: 18px; } .home-entry-grid { gap: 10px; margin-bottom: 26px; } .home-empty { padding: 32px 0; } }
</style>
