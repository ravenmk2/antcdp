<script setup lang="ts">
import { ref, watch } from "vue";
import { ElButton, ElDialog, ElInput, ElSelect, ElOption, ElMessage, ElMessageBox } from "element-plus";
import { request } from "../../shared/api";
import { message, diagnosticLabels, type WebhookSettings, type Diagnostic } from "./types";
import { useUnsaved } from "./unsaved";

const props = defineProps<{ base: string; connectionEnabled: boolean }>();
const settings = ref<WebhookSettings>(), etag = ref(""), receiver = ref("");
const diagnostic = ref<Diagnostic | null>(null), loading = ref(true), busy = ref(false), error = ref("");
const secretDialog = ref(false), secretError = ref(""), token = ref(""), method = ref("secret_token"), oneTime = ref("");
let generation = 0;
async function load() {
  const base = props.base, g = ++generation;
  loading.value = true; error.value = "";
  try {
    const [r, url, d] = await Promise.all([
      request<WebhookSettings>(base),
      request<{ receive_url: string }>(base + "/receiver"),
      request<{ latest: Diagnostic | null }>(base + "/diagnostics"),
    ]);
    if (g !== generation || base !== props.base) return;
    settings.value = r.data; etag.value = r.etag; receiver.value = url.data.receive_url; diagnostic.value = d.data.latest;
  } catch (e) { if (g === generation) error.value = message(e); }
  finally { if (g === generation) loading.value = false; }
}
watch(() => props.base, () => {
  settings.value = undefined; etag.value = ""; receiver.value = ""; diagnostic.value = null;
  secretDialog.value = false; token.value = ""; oneTime.value = ""; void load();
}, { immediate: true });
function openSecret() {
  token.value = ""; secretError.value = "";
  method.value = settings.value?.verification_method ?? "secret_token"; secretDialog.value = true;
}
async function replaceSecret(generate: boolean) {
  if (!settings.value || busy.value) return;
  busy.value = true; secretError.value = "";
  try {
    if (settings.value.has_secret) await ElMessageBox.confirm("旧秘密会立即失效，请同步更新使用此连接接收地址的所有 GitLab Hook。", "替换验证秘密", { confirmButtonText: "替换", cancelButtonText: "取消" });
    if (generate) {
      const r = await request<{ webhook: WebhookSettings; secret: { token: string } }>(props.base + "/verification/generate", { method: "POST", etag: etag.value, body: {} });
      // Capture before refreshing: a refresh failure must not lose the one-time secret.
      oneTime.value = r.data.secret.token; settings.value = r.data.webhook; etag.value = r.etag;
    } else {
      const r = await request<WebhookSettings>(props.base + "/verification", { method: "PUT", etag: etag.value, body: { verification_method: method.value, secret: { token: token.value } } });
      settings.value = r.data; etag.value = r.etag;
    }
    token.value = ""; secretDialog.value = false; await load(); ElMessage.success("验证秘密已保存，接收开关保持不变");
  } catch (e) { token.value = ""; if (e !== "cancel" && e !== "close") secretError.value = message(e); }
  finally { busy.value = false; }
}
async function toggle() {
  if (!settings.value || busy.value) return;
  busy.value = true; error.value = "";
  try {
    const r = await request<WebhookSettings>(props.base, { method: "PATCH", etag: etag.value, body: { enabled: !settings.value.enabled } });
    settings.value = r.data; etag.value = r.etag; await load();
  } catch (e) { error.value = message(e); }
  finally { busy.value = false; }
}
async function copy(value: string) {
  try { await navigator.clipboard.writeText(value); ElMessage.success("已复制"); }
  catch { ElMessage.info("请选中文本手动复制"); }
}
useUnsaved(() => secretDialog.value || !!oneTime.value, () => busy.value);
</script>

<template>
  <section class="integration-section">
    <div class="integration-toolbar">
      <div><h2>Webhook 接收设置</h2><p>此连接使用一个接收地址和一份验证秘密。事件筛选与项目关联在消费方配置。</p></div>
      <ElButton :disabled="busy || loading" @click="load">刷新</ElButton>
    </div>
    <div v-if="error" class="error-banner" role="alert">{{ error }} <ElButton link :disabled="busy || loading" @click="load">重新加载</ElButton></div>
    <p v-if="loading" role="status">正在加载接收设置…</p>
    <div v-else-if="settings" class="webhook-settings integration-card">
      <p>{{ settings.enabled ? '已启用接收' : '已停用接收' }} · {{ settings.has_secret ? '已配置秘密' : '未配置秘密' }}</p>
      <label class="integration-form">接收地址<ElInput :model-value="receiver" readonly aria-label="Webhook 接收地址" /></label>
      <ElButton link @click="copy(receiver)">复制接收地址</ElButton>
      <ol class="integration-steps">
        <li>导入或生成此连接的验证秘密。</li>
        <li>在 GitLab Webhooks 中填写此地址及秘密，配置需要投递的事件。</li>
        <li>开启接收，再从 GitLab 发送测试事件。</li>
      </ol>
      <p>{{ settings.verification_method === 'signing_token' ? 'Signing Token · HMAC-SHA256' : 'Secret Token' }}</p>
      <div class="integration-actions">
        <ElButton :disabled="busy" @click="openSecret">{{ settings.has_secret ? '替换验证秘密' : '配置验证秘密' }}</ElButton>
        <ElButton :disabled="busy || !settings.has_secret" @click="toggle">{{ settings.enabled ? '停用接收' : '启用接收' }}</ElButton>
      </div>
      <p v-if="!connectionEnabled" class="integration-note">连接已停用，当前不会接收；接收开关设置保留。</p>
      <h3>最近接收</h3>
      <p v-if="diagnostic">{{ diagnostic.outdated ? '历史结果 · ' : '' }}{{ diagnosticLabels[diagnostic.status] }} · {{ diagnostic.summary.event_type }}<span v-if="diagnostic.summary.source_project_id"> · GitLab 项目 {{ diagnostic.summary.source_project_id }}</span> · {{ new Date(diagnostic.started_at).toLocaleString() }}</p>
      <p v-else>尚无已认证事件。保存秘密后需显式启用接收。</p>
    </div>
    <ElDialog v-model="secretDialog" title="配置 Webhook 验证秘密" width="min(560px, 94vw)" :close-on-click-modal="false" :show-close="!busy" :close-on-press-escape="!busy" @closed="token = ''">
      <form class="integration-form" @submit.prevent="replaceSecret(false)">
        <div v-if="secretError" class="error-banner" role="alert">{{ secretError }} <ElButton link :disabled="busy" @click="load">重新加载版本</ElButton></div>
        <label>验证方式<ElSelect v-model="method" :disabled="busy"><ElOption label="Secret Token" value="secret_token" /><ElOption label="Signing Token（需要 GitLab 支持）" value="signing_token" /></ElSelect></label>
        <label>新秘密<ElInput v-model="token" type="password" show-password autocomplete="new-password" maxlength="8192" :disabled="busy" /></label>
        <p>保存后不可读取。替换立即生效，接收开关保持不变。</p>
        <div class="integration-actions"><ElButton v-if="method === 'secret_token'" :disabled="busy" @click="replaceSecret(true)">生成并保存</ElButton><ElButton native-type="submit" type="primary" :disabled="!token || loading" :loading="busy">导入并替换</ElButton></div>
      </form>
    </ElDialog>
    <ElDialog :model-value="!!oneTime" title="请立即保存新秘密" width="min(560px, 94vw)" :close-on-click-modal="false" @update:model-value="oneTime = ''">
      <p>仅显示一次，请复制到 GitLab 的 Secret Token，关闭后无法再次读取。</p><ElInput :model-value="oneTime" readonly aria-label="本次生成的 Webhook Token" />
      <template #footer><ElButton @click="copy(oneTime)">复制</ElButton><ElButton type="primary" @click="oneTime = ''">已保存，关闭</ElButton></template>
    </ElDialog>
  </section>
</template>
