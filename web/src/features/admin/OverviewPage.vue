<script setup lang="ts">
import { onMounted, ref } from "vue";
import AppLayout from "../../app/AppLayout.vue";
import { api } from "../../shared/api";
import { useIdentity, errorMessage } from "../identity/store";
import OverviewMetric from "./OverviewMetric.vue";
import OverviewSection from "./OverviewSection.vue";
import AuditDetail from "./AuditDetail.vue";
import { actionLabels, actionIcon } from "./audit";
interface Event {
  id: string;
  action: string;
  actor: { display_name: string };
  target: { label: string };
  occurred_at: string;
}
interface Overview {
  users_total: number;
  users_active: number;
  users_disabled: number;
  admins_total: number;
  registration_enabled: boolean;
  session_ttl_days: number;
  recent_events: Event[];
}
import UiIcon from "../../shared/UiIcon.vue";
const identity = useIdentity();
const data = ref<Overview>();
const metrics = [
  { key: "users_total", label: "全部用户", icon: "users", to: "/admin/users" },
  { key: "users_active", label: "正常账号", icon: "user", to: "/admin/users?status=active" },
  { key: "users_disabled", label: "已禁用", icon: "block", to: "/admin/users?status=disabled" },
  { key: "admins_total", label: "管理员", icon: "shield" },
] as const;
const shortcuts = [
  { label: "添加用户", icon: "plus", to: "/admin/users?create=1" },
  { label: "注册与会话", icon: "key", to: "/admin/settings?tab=access" },
  { label: "系统信息", icon: "device", to: "/admin/settings?tab=system" },
] as const;
const error = ref("");
const loading = ref(true);
const detailOpen = ref(false);
const detailID = ref("");
function showEvent(id: string) {
  detailID.value = id;
  detailOpen.value = true;
}
async function load() {
  if (loading.value && data.value) return;
  loading.value = true;
  error.value = "";
  try {
    data.value = await api<Overview>("/admin/overview");
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}
onMounted(load);
</script>
<template>
  <AppLayout>
    <div class="console-overview" :aria-busy="loading">
      <div v-if="error" class="error-banner" role="alert">{{ error }} <button class="btn" :disabled="loading" @click="load">重试</button></div>
      <template v-if="data">
        <section class="overview-metric-grid" aria-label="账号概况">
          <OverviewMetric v-for="metric in metrics" :key="metric.key"
            :label="metric.label" :value="data[metric.key]" :icon="metric.icon"
            :to="'to' in metric ? metric.to : undefined" />
        </section>
        <div class="overview-content-grid">
          <OverviewSection title="最近操作" class="overview-recent">
            <template #actions><RouterLink class="overview-text-link" to="/admin/audit">查看全部<UiIcon name="arrow" /></RouterLink></template>
            <div v-if="!data.recent_events.length" class="overview-empty" role="status">
              <UiIcon name="log" />
              <strong>暂无操作记录</strong>
            </div>
            <ul v-else class="overview-event-list">
              <li v-for="event in data.recent_events" :key="event.id">
                <button type="button" class="overview-event" @click="showEvent(event.id)">
                  <span class="overview-event-icon"><UiIcon :name="actionIcon(event.action)" /></span>
                  <span class="overview-event-copy">
                    <strong>{{ actionLabels[event.action] ?? event.action }}</strong>
                    <span>{{ event.actor.display_name }} · {{ event.target.label }}</span>
                  </span>
                  <time :datetime="event.occurred_at">{{ identity.date(event.occurred_at) }}</time>
                  <UiIcon class="overview-event-arrow" name="chevron" />
                </button>
              </li>
            </ul>
          </OverviewSection>
          <div class="overview-supporting">
            <OverviewSection title="常用操作">
              <nav class="overview-action-list" aria-label="常用操作">
                <RouterLink v-for="shortcut in shortcuts" :key="shortcut.to" :to="shortcut.to" class="overview-action">
                  <span class="overview-action-icon"><UiIcon :name="shortcut.icon" /></span>
                  <span><strong>{{ shortcut.label }}</strong></span>
                  <UiIcon name="chevron" />
                </RouterLink>
              </nav>
            </OverviewSection>
            <OverviewSection title="访问策略">
              <template #actions><RouterLink class="overview-text-link" to="/admin/settings?tab=access">管理<UiIcon name="arrow" /></RouterLink></template>
              <dl class="overview-policy-list">
                <div><dt>自主注册</dt><dd><span class="policy-state" :class="{ open: data.registration_enabled }">{{ data.registration_enabled ? '已开放' : '已关闭' }}</span></dd></div>
                <div><dt>会话闲置有效期</dt><dd>{{ data.session_ttl_days }} 天</dd></div>
                <div><dt>系统时区</dt><dd>{{ identity.settings.timezone }}</dd></div>
              </dl>
            </OverviewSection>
          </div>
        </div>
      </template>
      <div v-else-if="loading" class="overview-loading" role="status">正在加载概览…</div>
    </div>
    <AuditDetail v-model="detailOpen" :id="detailID" />
  </AppLayout>
</template>

<style scoped>
.console-overview { display: grid; gap: 20px; }
.overview-metric-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
.overview-content-grid { display: grid; grid-template-columns: minmax(0, 1.8fr) minmax(290px, 1fr); align-items: start; gap: 20px; }
.overview-supporting { display: grid; gap: 20px; min-width: 0; }
.overview-text-link { display: inline-flex; align-items: center; gap: 7px; padding: 7px 11px; border-radius: 7px; font-size: 14px; color: var(--text-muted); white-space: nowrap; }
.overview-text-link:hover { background: var(--accent-soft); color: var(--text-secondary); }
.overview-text-link .ui-icon { width: 16px; height: 16px; }
.overview-event-list { list-style: none; padding: 0; margin: 0; }
.overview-event-list li + li { border-top: 1px solid var(--border); }
.overview-event { display: grid; grid-template-columns: 34px minmax(0, 1fr) auto 16px; align-items: center; gap: 12px; width: 100%; padding: 18px 20px; border: 0; background: transparent; text-align: left; color: var(--text-secondary); cursor: pointer; }
.overview-event:hover, .overview-action:hover { background: var(--surface-subtle); }
.overview-event-icon, .overview-action-icon { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 9px; background: var(--surface-subtle); color: var(--text-secondary); }
.overview-event-copy { display: grid; gap: 4px; min-width: 0; }
.overview-event-copy strong { font-size: 14px; font-weight: 500; color: var(--text-primary); }
.overview-event-copy > span { font-size: 13px; color: var(--text-muted); overflow-wrap: anywhere; }
.overview-event time { font-size: 13px; color: var(--text-muted); white-space: nowrap; }
.overview-event-arrow { width: 16px; height: 16px; color: var(--text-muted); }
.overview-action-list { display: grid; padding: 4px 0; }
.overview-action { display: grid; grid-template-columns: 34px minmax(0, 1fr) 16px; align-items: center; gap: 12px; padding: 14px 20px; }
.overview-action > span:nth-child(2) { display: grid; gap: 3px; min-width: 0; }
.overview-action strong { font-size: 14px; font-weight: 500; color: var(--text-primary); }
.overview-action small { font-size: 13px; color: var(--text-muted); overflow-wrap: anywhere; }
.overview-action > .ui-icon { width: 16px; height: 16px; color: var(--text-muted); }
.overview-policy-list { margin: 0; padding: 4px 20px; }
.overview-policy-list > div { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 0; }
.overview-policy-list > div + div { border-top: 1px solid var(--border); }
.overview-policy-list dt { font-size: 13px; color: var(--text-muted); }
.overview-policy-list dd { margin: 0; font-size: 14px; text-align: right; overflow-wrap: anywhere; color: var(--text-primary); }
.policy-state { display: inline-flex; align-items: center; gap: 6px; }
.policy-state::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--text-muted); }
.policy-state.open::before { background: var(--success); }
.overview-empty, .overview-loading { display: grid; place-items: center; align-content: center; gap: 12px; padding: 48px 20px; color: var(--text-muted); text-align: center; }
.overview-empty { min-height: 320px; }
.overview-empty > .ui-icon { width: 30px; height: 30px; }
.overview-empty strong { font-size: 15px; font-weight: 500; color: var(--text-secondary); }
.overview-empty p { margin: 0; font-size: 13px; }
@media (max-width: 1200px) {
  .overview-event { grid-template-columns: 34px minmax(0, 1fr) 16px; }
  .overview-event-icon { grid-row: 1 / 3; }
  .overview-event time { grid-column: 2; }
  .overview-event-arrow { grid-column: 3; grid-row: 1 / 3; }
}
@media (max-width: 1050px) {
  .overview-content-grid { grid-template-columns: minmax(0, 1fr); }
  .overview-supporting { grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; }
  .overview-metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 600px) {
  .console-overview { gap: 16px; }
  .overview-metric-grid { gap: 12px; }
  .overview-supporting { grid-template-columns: minmax(0, 1fr); gap: 16px; }
  .overview-event { padding: 16px; gap: 8px 10px; }
  .overview-action { padding: 14px 16px; }
  .overview-policy-list { padding: 4px 16px; }
  .overview-empty { min-height: 220px; }
}
</style>
