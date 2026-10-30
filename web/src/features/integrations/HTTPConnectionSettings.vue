<script setup lang="ts">
import DiagnosticResult from "./DiagnosticResult.vue";
import { computed, reactive, ref, watch } from "vue";
import { ElButton, ElInput, ElSelect, ElOption, ElSwitch, ElMessage, ElMessageBox } from "element-plus";
import { request } from "../../shared/api";
import { useUnsaved } from "./unsaved";
import { message, type Diagnostic, type ServiceConnection } from "./types";
const props = defineProps<{ base: string; connection: ServiceConnection; etag: string }>();
const serviceName = computed(() => ({ gitlab: "GitLab", jenkins: "Jenkins", openobserve: "OpenObserve", elasticsearch: "Elasticsearch", mysql: "MySQL", postgresql: "PostgreSQL" }[props.connection.service_type] ?? props.connection.service_type));
const isDatabase = computed(() => ["mysql", "postgresql"].includes(props.connection.service_type));
const caEnabled = computed(() => isDatabase.value ? form.tls_mode === "verify-full" : form.base_url.toLowerCase().startsWith("https://"));
const emit = defineEmits<{ saved: [connection: ServiceConnection, etag: string] }>();
const form = reactive({ name: "", description: "", enabled: true, host: "", port: "", database: "", tls_mode: "disable", default_organization: "default", base_url: "", custom_ca_pem: "" });
const busy = ref(false), error = ref(""), diagnostic = ref<Diagnostic | null>(null);
function reset() { Object.assign(form, { name: props.connection.name, description: props.connection.description, enabled: props.connection.enabled, host: props.connection.config?.host ?? "", port: String(props.connection.config?.port ?? (props.connection.service_type === "mysql" ? 3306 : 5432)), database: props.connection.config?.database ?? "", tls_mode: props.connection.config?.tls_mode ?? "disable", default_organization: props.connection.config?.default_organization ?? "default", base_url: props.connection.config?.base_url ?? "", custom_ca_pem: props.connection.config?.custom_ca_pem ?? "" }); }
watch(() => props.connection, reset, { immediate: true });
const dirty = computed(() => (isDatabase.value && (form.host !== props.connection.config?.host || Number(form.port) !== props.connection.config?.port || form.database !== props.connection.config?.database || form.tls_mode !== props.connection.config?.tls_mode)) || (props.connection.service_type === "openobserve" && form.default_organization !== props.connection.config?.default_organization) || form.name !== props.connection.name || form.description !== props.connection.description || form.enabled !== props.connection.enabled || form.base_url !== (props.connection.config?.base_url ?? "") || form.custom_ca_pem !== (props.connection.config?.custom_ca_pem ?? ""));
async function refreshDiagnostic() {
  try { diagnostic.value = (await request<{ latest: Diagnostic | null }>(props.base + "/diagnostics")).data.latest; }
  catch (e) { error.value = message(e); }
}
watch(() => props.base, () => { diagnostic.value = null; void refreshDiagnostic(); }, { immediate: true });
async function reload() {
  if (dirty.value) { try { await ElMessageBox.confirm("重新加载会丢弃未保存的连接修改。", "重新加载", { confirmButtonText: "重新加载", cancelButtonText: "继续编辑" }); } catch { return; } }
  try { const r = await request<ServiceConnection>(props.base); emit("saved", r.data, r.etag); error.value = ""; await refreshDiagnostic(); } catch (e) { error.value = message(e); }
}
async function save() {
  if (busy.value) return; busy.value = true; error.value = "";
  try {
    if (form.host !== (props.connection.config?.host ?? "") || (isDatabase.value && Number(form.port) !== props.connection.config?.port) || form.database !== (props.connection.config?.database ?? "") || form.base_url !== (props.connection.config?.base_url ?? "")) await ElMessageBox.confirm("修改地址会影响此连接下全部凭证的访问目标。", "修改连接地址", { confirmButtonText: "保存", cancelButtonText: "取消" });
    const r = await request<ServiceConnection>(props.base, { method: "PATCH", etag: props.etag, body: { name: form.name, description: form.description, enabled: form.enabled, config: { ...(isDatabase.value ? { host: form.host, port: Number(form.port), database: form.database, tls_mode: form.tls_mode } : { base_url: form.base_url }), custom_ca_pem: form.custom_ca_pem || null, ...(props.connection.service_type === "openobserve" ? { default_organization: form.default_organization } : {}) } } });
    emit("saved", r.data, r.etag); await refreshDiagnostic(); ElMessage.success("连接已保存");
  } catch (e) { if (e !== "cancel" && e !== "close") error.value = message(e); } finally { busy.value = false; }
}
async function test() {
  if (busy.value) return; busy.value = true; error.value = "";
  try { diagnostic.value = (await request<Diagnostic>(props.base + "/test", { method: "POST", etag: props.etag, body: {} })).data; }
  catch (e) { error.value = message(e); } finally { busy.value = false; }
}
useUnsaved(() => dirty.value, () => busy.value);
</script>
<template>
  <section class="integration-section">
    <div v-if="error" class="error-banner" role="alert">{{ error }} <ElButton link @click="reload">重新加载</ElButton></div>
    <form class="integration-form connection-form" @submit.prevent="save">
      <h2>{{ serviceName }} 服务连接</h2><p>资料与访问配置一起保存。连接测试不使用访问凭证。</p><p v-if="isDatabase" class="integration-note">连接测试仅检查 TCP 可达性；凭证验证会连接指定数据库并执行 SELECT 1，不检查业务表权限。</p>
      <label>名称<ElInput v-model="form.name" maxlength="100" :disabled="busy" /></label>
      <label>说明<ElInput v-model="form.description" type="textarea" maxlength="1000" :disabled="busy" /></label>
      <template v-if="isDatabase">
        <label>主机<ElInput v-model="form.host" maxlength="253" :disabled="busy" /></label>
        <label>端口<ElInput v-model="form.port" maxlength="5" :disabled="busy" /></label>
        <label>默认数据库<ElInput v-model="form.database" maxlength="255" :disabled="busy" /></label>
      </template>
      <label v-else>实例地址<ElInput v-model="form.base_url" maxlength="2048" :disabled="busy" /><small>支持 HTTP、HTTPS 和子路径。</small></label>
      <label v-if="connection.service_type === 'openobserve'">默认组织<ElInput v-model="form.default_organization" maxlength="128" :disabled="busy" /><small>默认使用 default，未来操作可以指定其他组织。</small></label>
      <p v-if="connection.service_type === 'elasticsearch'" class="integration-note">支持无认证集群，无需创建空凭证。连接测试不验证身份。</p>
      <label v-if="isDatabase">TLS 模式<ElSelect v-model="form.tls_mode" :disabled="busy"><ElOption value="verify-full" label="启用并校验证书" /><ElOption value="disable" label="禁用 TLS" /></ElSelect><small>默认禁用 TLS；启用后校验证书和主机名。</small></label>
      <details><summary>高级 TLS 配置</summary><p v-if="!caEnabled" class="integration-note">启用 TLS 后使用，已有 CA 配置保留。</p><label>公共 CA（可选）<ElInput v-model="form.custom_ca_pem" type="textarea" :rows="5" maxlength="16384" :disabled="busy || !caEnabled" /><small>始终校验证书和主机名，不接收私钥。</small></label></details>
      <label>启用连接<ElSwitch v-model="form.enabled" :disabled="busy" /><small>{{ connection.service_type !== "gitlab" ? "停用后阻止连接测试和凭证验证，已有凭证保留。" : "停用后阻止外部验证及 Webhook 接收，凭证和接收开关设置保留。" }}</small></label>
      <div class="integration-actions"><ElButton type="primary" native-type="submit" :disabled="!dirty" :loading="busy">保存连接</ElButton><ElButton :disabled="busy || dirty || !connection.enabled" @click="test">测试已保存连接</ElButton><ElButton :disabled="busy" @click="reload">重新加载</ElButton></div>
      <p v-if="diagnostic" class="integration-note diagnostic-detail"><DiagnosticResult :diagnostic="diagnostic" /> · {{ new Date(diagnostic.started_at).toLocaleString() }}</p>
    </form>
  </section>
</template>
