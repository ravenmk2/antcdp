<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { ElButton, ElInput, ElSwitch, ElMessage, ElMessageBox } from "element-plus";
import { request } from "../../shared/api";
import { useUnsaved } from "./unsaved";
import { message, diagnosticLabels, type Diagnostic, type ServiceConnection } from "./types";
const props = defineProps<{ base: string; connection: ServiceConnection; etag: string }>();
const emit = defineEmits<{ saved: [connection: ServiceConnection, etag: string] }>();
const form = reactive({ name: "", description: "", enabled: true, base_url: "", custom_ca_pem: "" });
const busy = ref(false), error = ref(""), diagnostic = ref<Diagnostic | null>(null);
function reset() { Object.assign(form, { name: props.connection.name, description: props.connection.description, enabled: props.connection.enabled, base_url: props.connection.config?.base_url ?? "", custom_ca_pem: props.connection.config?.custom_ca_pem ?? "" }); }
watch(() => props.connection, reset, { immediate: true });
const dirty = computed(() => form.name !== props.connection.name || form.description !== props.connection.description || form.enabled !== props.connection.enabled || form.base_url !== props.connection.config?.base_url || form.custom_ca_pem !== (props.connection.config?.custom_ca_pem ?? ""));
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
    if (form.base_url !== props.connection.config?.base_url) await ElMessageBox.confirm("修改地址会影响此连接下全部凭证的访问目标。", "修改连接地址", { confirmButtonText: "保存", cancelButtonText: "取消" });
    const r = await request<ServiceConnection>(props.base, { method: "PATCH", etag: props.etag, body: { name: form.name, description: form.description, enabled: form.enabled, config: { base_url: form.base_url, custom_ca_pem: form.custom_ca_pem || null } } });
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
      <h2>GitLab 服务连接</h2><p>资料与访问配置一起保存。连接测试不使用访问凭证。</p>
      <label>连接 code<ElInput :model-value="connection.code" readonly /></label>
      <label>名称<ElInput v-model="form.name" maxlength="100" :disabled="busy" /></label>
      <label>说明<ElInput v-model="form.description" type="textarea" maxlength="1000" :disabled="busy" /></label>
      <label>实例地址<ElInput v-model="form.base_url" maxlength="2048" :disabled="busy" placeholder="https://gitlab.example.com" /><small>支持子路径，要求 HTTPS。</small></label>
      <details><summary>高级 TLS 配置</summary><label>公共 CA（可选）<ElInput v-model="form.custom_ca_pem" type="textarea" :rows="5" maxlength="16384" :disabled="busy" /><small>始终校验证书和主机名，不接收私钥。</small></label></details>
      <label>启用连接<ElSwitch v-model="form.enabled" :disabled="busy" /><small>停用后阻止外部验证及Webhook 接收，凭证和接收开关设置保留。</small></label>
      <div class="integration-actions"><ElButton type="primary" native-type="submit" :disabled="!dirty" :loading="busy">保存连接</ElButton><ElButton :disabled="busy || dirty || !connection.enabled" @click="test">测试已保存连接</ElButton><ElButton :disabled="busy" @click="reload">重新加载</ElButton></div>
      <p v-if="diagnostic" class="integration-note">{{ diagnostic.outdated ? '历史结果 · ' : '' }}{{ diagnosticLabels[diagnostic.status] }} · {{ new Date(diagnostic.started_at).toLocaleString() }}</p>
    </form>
  </section>
</template>
