<script setup lang="ts">
import UiIcon from "../../shared/UiIcon.vue";
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
const editing = ref(false), diagnosticLoaded = ref(false);
const busy = ref(false), error = ref(""), diagnostic = ref<Diagnostic | null>(null);
function reset() { Object.assign(form, { name: props.connection.name, description: props.connection.description, enabled: props.connection.enabled, host: props.connection.config?.host ?? "", port: String(props.connection.config?.port ?? (props.connection.service_type === "mysql" ? 3306 : 5432)), database: props.connection.config?.database ?? "", tls_mode: props.connection.config?.tls_mode ?? "disable", default_organization: props.connection.config?.default_organization ?? "default", base_url: props.connection.config?.base_url ?? "", custom_ca_pem: props.connection.config?.custom_ca_pem ?? "" }); }
watch(() => props.connection, reset, { immediate: true });
const dirty = computed(() => editing.value && ((isDatabase.value && (form.host !== props.connection.config?.host || Number(form.port) !== props.connection.config?.port || form.database !== props.connection.config?.database || form.tls_mode !== props.connection.config?.tls_mode)) || (props.connection.service_type === "openobserve" && form.default_organization !== props.connection.config?.default_organization) || form.name !== props.connection.name || form.description !== props.connection.description || form.enabled !== props.connection.enabled || form.base_url !== (props.connection.config?.base_url ?? "") || form.custom_ca_pem !== (props.connection.config?.custom_ca_pem ?? "")));
function startEditing() { reset(); error.value = ""; editing.value = true; }
function cancelEditing() { reset(); error.value = ""; editing.value = false; }
const savedCAEnabled = computed(() => isDatabase.value ? props.connection.config?.tls_mode === "verify-full" : String(props.connection.config?.base_url ?? "").toLowerCase().startsWith("https://"));
async function refreshDiagnostic() {
  try { diagnostic.value = (await request<{ latest: Diagnostic | null }>(props.base + "/diagnostics")).data.latest; diagnosticLoaded.value = true; }
  catch (e) { error.value = message(e); }
}
watch(() => props.base, () => { diagnostic.value = null; diagnosticLoaded.value = false; void refreshDiagnostic(); }, { immediate: true });
async function reload() {
  if (dirty.value) { try { await ElMessageBox.confirm("重新加载会丢弃未保存的连接修改。", "重新加载", { confirmButtonText: "重新加载", cancelButtonText: "继续编辑" }); } catch { return; } }
  try { const r = await request<ServiceConnection>(props.base); emit("saved", r.data, r.etag); error.value = ""; await refreshDiagnostic(); } catch (e) { error.value = message(e); }
}
async function save() {
  if (busy.value || !editing.value || !dirty.value) return; busy.value = true; error.value = "";
  try {
    if (form.host !== (props.connection.config?.host ?? "") || (isDatabase.value && Number(form.port) !== props.connection.config?.port) || form.database !== (props.connection.config?.database ?? "") || form.base_url !== (props.connection.config?.base_url ?? "")) await ElMessageBox.confirm("修改地址会影响此连接下全部凭证的访问目标。", "修改连接地址", { confirmButtonText: "保存", cancelButtonText: "取消" });
    const r = await request<ServiceConnection>(props.base, { method: "PATCH", etag: props.etag, body: { name: form.name, description: form.description, enabled: form.enabled, config: { ...(isDatabase.value ? { host: form.host, port: Number(form.port), database: form.database, tls_mode: form.tls_mode } : { base_url: form.base_url }), custom_ca_pem: form.custom_ca_pem || null, ...(props.connection.service_type === "openobserve" ? { default_organization: form.default_organization } : {}) } } });
    emit("saved", r.data, r.etag); editing.value = false; await refreshDiagnostic(); ElMessage.success("连接已保存");
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
  <section class="connection-ui-section connection-settings">
    <div v-if="error" class="error-banner" role="alert">{{ error }} <ElButton link @click="reload">重新加载</ElButton></div>
    <div class="connection-ui-settings-heading"><div><h2>{{ serviceName }} 服务连接</h2><p>{{ editing ? '编辑连接资料与访问配置，保存后生效。' : '连接资料与访问配置' }}</p></div><ElButton v-if="!editing" :disabled="busy" @click="startEditing"><UiIcon name="edit" />编辑</ElButton></div>
    <div v-if="!editing" class="connection-read-view">
      <dl class="connection-ui-properties">
        <div><dt>连接名称</dt><dd>{{ connection.name }}</dd></div>
        <div><dt>说明</dt><dd>{{ connection.description || '未填写' }}</dd></div>
        <template v-if="isDatabase">
          <div><dt>主机</dt><dd class="connection-ui-technical-value">{{ connection.config?.host }}</dd></div>
          <div><dt>端口</dt><dd class="connection-ui-technical-value">{{ connection.config?.port }}</dd></div>
          <div><dt>默认数据库</dt><dd class="connection-ui-technical-value">{{ connection.config?.database || '未配置' }}</dd></div>
          <div><dt>TLS 模式</dt><dd>{{ connection.config?.tls_mode === 'verify-full' ? '启用并校验证书' : '禁用 TLS' }}</dd></div>
        </template>
        <div v-else><dt>实例地址</dt><dd class="connection-ui-technical-value">{{ connection.config?.base_url }}</dd></div>
        <div v-if="connection.service_type === 'openobserve'"><dt>默认组织</dt><dd>{{ connection.config?.default_organization || 'default' }}</dd></div>
        <div><dt>连接状态</dt><dd><span class="connection-ui-status" :class="{ enabled: connection.enabled }">{{ connection.enabled ? '已启用' : '已停用' }}</span></dd></div>
      </dl>
      <details class="connection-read-tls"><summary>高级 TLS 配置 <span>{{ connection.config?.custom_ca_pem ? '已配置自定义 CA' : '未配置自定义 CA' }}</span></summary>
        <p v-if="!savedCAEnabled">当前未启用 TLS，已有 CA 配置保留但不生效。</p>
        <template v-else><p>使用系统信任的证书颁发机构及已配置的公共 CA，校验证书和主机名。</p></template>
        <dl class="connection-ui-properties"><div><dt>公共 CA</dt><dd><pre v-if="connection.config?.custom_ca_pem">{{ connection.config.custom_ca_pem }}</pre><span v-else>未配置</span></dd></div></dl>
      </details>
      <div class="connection-ui-test-section"><div><h3>连接测试</h3>
        <p v-if="diagnostic" class="diagnostic-detail"><DiagnosticResult :diagnostic="diagnostic" /> · {{ new Date(diagnostic.started_at).toLocaleString() }}</p>
        <p v-else>{{ diagnosticLoaded ? '尚无测试记录' : '测试记录尚未加载' }}</p>
        <p>{{ isDatabase ? '连接测试仅检查 TCP 可达性；凭证验证会连接指定数据库并执行 SELECT 1，不检查业务表权限。' : '连接测试不使用访问凭证，不代表身份认证或业务权限验证通过。' }}</p>
        <p v-if="connection.service_type === 'elasticsearch'">支持无认证集群，无需创建空凭证。</p>
      </div><ElButton :disabled="busy || !connection.enabled" @click="test">测试已保存连接</ElButton></div>
    </div>
    <form v-else class="connection-ui-form connection-ui-config-form" @submit.prevent="save">
      <p v-if="isDatabase" class="integration-note">连接测试仅检查 TCP 可达性；凭证验证会连接指定数据库并执行 SELECT 1，不检查业务表权限。</p>
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
      <div class="connection-ui-actions"><ElButton type="primary" native-type="submit" :disabled="!dirty" :loading="busy">保存连接</ElButton><ElButton :disabled="busy" @click="cancelEditing">取消</ElButton></div>
    </form>
  </section>
</template>
