<script setup lang="ts">
import PageSizeSelect from "../../shared/PageSizeSelect.vue";
import UiIcon from "../../shared/UiIcon.vue";
import ConnectionCode from "./ConnectionCode.vue";
import ClearFiltersButton from "../../shared/ClearFiltersButton.vue";
import { useUnsaved } from "./unsaved";
import { computed, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  ElButton,
  ElInput,
  ElDialog,
  ElSelect,
  ElOption,
  ElMessageBox,
  ElMessage,
  ElDropdown,
  ElDropdownMenu,
  ElDropdownItem,
} from "element-plus";
import AppLayout from "../../app/AppLayout.vue";
import ServiceIcon from "./ServiceIcon.vue";
import CredentialsPanel from "./CredentialsPanel.vue";
import SSHHostKeys from "./SSHHostKeys.vue";

import { serviceUI, authenticationUI } from "./providers";
import ProviderFields from "./ProviderFields.vue";
import { request } from "../../shared/api";
import { message, type Capability, type RemoteHost } from "./types";
import "./remote-hosts.css";
const route = useRoute(),
  router = useRouter();
const resourceLabel = computed(() => "主机");
const resourceRoute = computed(() => "remote-hosts");
function apiResource(_kind: string) { return "remote-hosts"; }
const admin = computed(() => route.path.startsWith("/admin/"));
const projectID = computed(() => String(route.params.projectID ?? ""));
const scopeLabel = computed(() =>
  admin.value ? "远程主机" : projectID.value ? "项目 SSH 凭证" : "个人 SSH 凭证",
);
const items = ref<RemoteHost[]>([]),
  types = ref<Capability[]>([]),
  selected = ref<RemoteHost>(),
  loading = ref(true),
  busy = ref(false),
  error = ref(""),
  query = ref(String(route.query.q ?? "")),
  typeFilter = ref(String(route.query.type ?? "")),
  statusFilter = ref(String(route.query.status ?? "")),
  tab = ref("connection"),
  tag = ref(""),
  readonly = ref(false),
  projectName = ref("");
const dialog = ref(false),
  formError = ref("");
const step = ref(2);
const createdConnection = ref<RemoteHost>();
const credentialValues = ref<Record<string, string>>({});
const credential = reactive({ name: "", code: "", expires_at: "" });
async function closeCreate(done?: () => void) {
  if (busy.value) return;
  if (form.name || form.code || form.description || Object.values(providerValues.value).some(Boolean) || Object.values(credentialValues.value).some(Boolean) || credential.name || credential.code || credential.expires_at) {
    try { await ElMessageBox.confirm(createdConnection.value ? "连接已创建，关闭后可在详情继续添加凭证。" : "关闭将丢弃本次未保存的内容。", "关闭添加连接", { confirmButtonText: "关闭", cancelButtonText: "继续填写" }); } catch { return; }
  }
  dialog.value = false;
  credentialValues.value = {};
  done?.();
  if (createdConnection.value) choose(createdConnection.value);
}
function nextStep() {
  formError.value = "";
  if (!serviceUI[form.service_type]) { formError.value = "请选择服务类型"; return; }
  if (step.value === 2) {
    if (!form.name.trim()) { formError.value = "请输入主机名称"; return; }
    if (form.service_type === "ssh") {
 const v=providerValues.value, port=Number(v.port ?? 22); if(!v.host?.trim() || !Number.isInteger(port) || port<1 || port>65535) { formError.value="请填写主机地址和有效端口"; return; }
 }
    if (form.code && !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(form.code)) { formError.value = "编码须以小写字母或数字开头，仅含小写字母、数字、下划线或短横线，最长 64 位"; return; }
  }
  step.value++;
}
const providerValues = ref<Record<string, string>>({});
const authMethod = ref("ssh_password");
const credentialAdapter = computed(() => authenticationUI(form.service_type, authMethod.value));
watch(authMethod, () => { credentialValues.value = {}; }, { flush: "sync" });
const form = reactive({
  service_type: "",
  code: "",
  name: "",
  description: "",
});
watch(
  () => form.service_type,
  (_value, previous) => {
    if (dialog.value && previous && (Object.values(providerValues.value).some(Boolean) || Object.values(credentialValues.value).some(Boolean))) ElMessage.info("服务类型已更换，原类型的连接配置和认证材料已清空。");
    providerValues.value = {port:"22"};
    credentialValues.value = {};
  },
);
const id = computed(() => String(route.params.integrationID ?? ""));
const capability = computed(() =>
  types.value.find((t) => t.service_type === selected.value?.service_type),
);
const providerPath = computed(() =>
  selected.value
    ? `/admin/${apiResource(selected.value.service_type)}/${selected.value.id}`
    : "",
);
const credentialsPath = computed(() =>
  selected.value
    ? `${admin.value ? "/admin" : projectID.value ? "/projects/" + projectID.value : "/me"}/${apiResource(selected.value.service_type)}/${selected.value.id}/credentials`
    : "",
);
const filterTypes = computed(() => {
  const names = new Map(types.value.map((t) => [t.service_type, t.name]));
  for (const item of items.value) if (!names.has(item.service_type)) names.set(item.service_type, item.service_type);
  return Array.from(names, ([service_type, name]) => ({
    service_type, name, count: items.value.filter((i) => i.service_type === service_type).length,
  }));
});
function readPage(value: unknown) { const n = Number(value); return Number.isSafeInteger(n) && n > 0 ? n : 1; }
function readPageSize(value: unknown) { const n = Number(value); return [10, 20, 50, 100].includes(n) ? n : 20; }
const page = ref(readPage(route.query.page)), pageSize = ref(readPageSize(route.query.page_size));
let syncingListQuery = false;
const listQuery = computed(() => ({ type: typeFilter.value || undefined, q: query.value || undefined, status: statusFilter.value || undefined, page: String(page.value), page_size: String(pageSize.value) }));
watch([query, statusFilter, typeFilter, pageSize], () => { if (!syncingListQuery) page.value = 1; }, { flush: "sync" });
watch([query, statusFilter, typeFilter, pageSize, page], () => {
  if (!id.value && !syncingListQuery) void router.replace({ query: { ...route.query, ...listQuery.value } });
});
watch(() => route.query, value => {
  syncingListQuery = true;
  query.value = String(value.q ?? ""); statusFilter.value = String(value.status ?? ""); typeFilter.value = String(value.type ?? "");
  pageSize.value = readPageSize(value.page_size); page.value = readPage(value.page);
  syncingListQuery = false;
});
function resetFilters() { query.value = ""; statusFilter.value = ""; typeFilter.value = ""; }
const visible = computed(() =>
  items.value.filter(
    (i) =>
      (!typeFilter.value || i.service_type === typeFilter.value) &&
      (!statusFilter.value || i.enabled === (statusFilter.value === "enabled")) &&
      `${i.name} ${i.code} ${i.description}`
        .toLowerCase()
        .includes(query.value.trim().toLowerCase()),
  ),
);
const pageCount = computed(() => Math.max(1, Math.ceil(visible.value.length / pageSize.value)));
const pagedConnections = computed(() => visible.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value));
watch([pageCount, loading, page], () => { if (!loading.value && page.value > pageCount.value) page.value = pageCount.value; });
let generation = 0;
async function load() {
  const g = ++generation;
  loading.value = true;
  error.value = "";
  selected.value = undefined;
  try {
    const [t, r] = await Promise.all([
      Promise.resolve({data:{items:[{service_type:"ssh", name:"SSH",credentials:true,connection_test:true,auth_methods:["ssh_password","ssh_private_key","ssh_encrypted_key"],webhook:{supported:false,verification_methods:[]}}]}}),
      request<{ items: RemoteHost[] }>("/remote-hosts"),
    ]);
    let project:
      | {
          name: string;
          can_manage: boolean;
          status: string;
          direct_role: string;
        }
      | undefined;
    if (projectID.value)
      project = (await request<typeof project>(`/projects/${projectID.value}`))
        .data;
    let detail: { data: RemoteHost; etag: string } | undefined;
    if (id.value && admin.value) {
      const entry = r.data.items.find((v) => v.id === id.value);
      if (!entry) throw new Error("连接不存在");
      detail = await request<RemoteHost>(
        `/admin/${apiResource(entry.service_type)}/${entry.id}`,
      );
    }
    if (g !== generation) return;
    types.value = t.data.items.filter((t) => serviceUI[t.service_type]);
    items.value = r.data.items;
    projectName.value = project?.name ?? "";
    readonly.value = project?.status === "archived";
    if (detail) {
      selected.value = detail.data;
      tag.value = detail.etag;
    } else if (!admin.value && id.value) {
      selected.value = r.data.items.find((v) => v.id === id.value);
    }
  } catch (e) {
    if (g === generation) error.value = message(e);
  } finally {
    if (g === generation) loading.value = false;
  }
}
watch(
  () => route.path,
  () => {
    dialog.value = false;
    tab.value = admin.value ? "connection" : "credentials";
    void load();
  },
  { immediate: true },
);
function choose(item: RemoteHost) {
  void router.push({
    path: admin.value
      ? `/admin/${resourceRoute.value}/${item.id}`
      : projectID.value
        ? `/projects/${projectID.value}/${resourceRoute.value}/${item.id}`
        : `/account/${resourceRoute.value}/${item.id}`,
    query: listQuery.value,
  });
}
function openCreate() {
  step.value = 2; authMethod.value = "ssh_password"; createdConnection.value = undefined;
  credentialValues.value = {}; credential.name = ""; credential.code = ""; credential.expires_at = "";
  providerValues.value = {port:"22"};
  formError.value = "";
  Object.assign(form, {
    service_type: types.value.find((t) => t.service_type === typeFilter.value)?.service_type ?? types.value[0]?.service_type ?? "",
    code: "",
    name: "",
    description: "",
  });
  dialog.value = true;
}

function connectionSaved(value: RemoteHost, etag: string) {
  selected.value = value; tag.value = etag;
  const index = items.value.findIndex(item => item.id === value.id);
  if (index >= 0) items.value[index] = value;
}
async function save(skipCredential = false) {
  if (busy.value) return;
  formError.value = "";
  if (!form.name.trim()) {
    formError.value = "请输入主机名称";
    return;
  }
  if (!skipCredential) {
    formError.value = !credential.name.trim() ? "请输入凭证名称" : credentialAdapter.value.validateSecret(credentialValues.value);
    if (formError.value) return;
    if (credential.code.trim() && !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(credential.code.trim())) { formError.value = "凭证编码格式不正确，请使用小写字母、数字、下划线或短横线，以字母或数字开头"; return; }
    if (credential.expires_at && !Number.isFinite(Date.parse(credential.expires_at))) { formError.value = "请输入有效的到期时间"; return; }
  }
  busy.value = true;
  try {
      if (!createdConnection.value) {
      const r = await request<RemoteHost>(
        `/admin/${apiResource(form.service_type)}`,
        {
          method: "POST",
          body: {
            name: form.name,
            description: form.description,
            code: form.code,
            config: serviceUI[form.service_type]!.connectionBody(providerValues.value),
          },
        },
      );
      createdConnection.value = r.data;
      }
      if (!skipCredential) {
        const base = `/admin/${apiResource(form.service_type)}/${createdConnection.value.id}/credentials`;
        const collection = await request(base);
        const adapter = credentialAdapter.value;
        await request(base, { method: "POST", etag: collection.etag, body: {
          name: credential.name, code: credential.code.trim(), description: "",
          expires_at: credential.expires_at ? new Date(credential.expires_at).toISOString() : null,
          authentication: { auth_method: adapter.authMethod, identity_config: adapter.identityBody(credentialValues.value), secret: adapter.secretBody(credentialValues.value) },
        } });
      }
      credentialValues.value = {};
      dialog.value = false;
      busy.value = false;
      choose(createdConnection.value);
      ElMessage.success(`${resourceLabel.value}已创建`);
      return;
  } catch (e) {
    for (const field of credentialAdapter.value.secretFields) credentialValues.value[field.key] = "";
    formError.value = (createdConnection.value ? "连接已创建，凭证未保存。请重新填写认证信息后重试，或暂不添加。" : "") + message(e);
  } finally {
    busy.value = false;
  }
}
async function detailAction(command: string) {
 if(command === "delete") { await remove(); return; }
 if(!selected.value || busy.value) return;
 try { await ElMessageBox.confirm(selected.value.enabled ? "停用后禁止连接测试和凭证验证，保留配置与凭证。" : "启用此主机？", selected.value.enabled ? "停用主机" : "启用主机", {confirmButtonText:"确认",cancelButtonText:"取消"}); busy.value=true; const r=await request<RemoteHost>(providerPath.value,{method:"PATCH",etag:tag.value,body:{enabled:!selected.value.enabled}}); connectionSaved(r.data,r.etag); } catch(e) { if(e!=="cancel" && e!=="close") error.value=message(e); } finally {busy.value=false;}
}
async function remove() {
  if (!selected.value) return;
  busy.value = true;
  error.value = "";
  try {
    await ElMessageBox.confirm(
      `删除“${selected.value.name}”？请先移除全部归属的凭证。受信任公钥将一并删除。`,
      "删除连接",
      { type: "warning", confirmButtonText: "删除", cancelButtonText: "取消" },
    );
    await request(providerPath.value, {
      method: "DELETE",
      etag: tag.value,
    });
    busy.value = false;
    await router.push(`/admin/${resourceRoute.value}`);
  } catch (e) {
    if (e !== "cancel" && e !== "close") error.value = message(e);
  } finally {
    busy.value = false;
  }
}
const listPath = computed(() =>
  admin.value
    ? `/admin/${resourceRoute.value}`
    : projectID.value
      ? `/projects/${projectID.value}/${resourceRoute.value}`
      : `/account/${resourceRoute.value}`,
);
const breadcrumbs = computed(() => [
  ...(projectID.value
    ? [
        {
          label: projectName.value || "项目",
          to: `/projects/${projectID.value}`,
        },
      ]
    : []),
  { label: scopeLabel.value, to: selected.value || typeFilter.value ? router.resolve({ path: listPath.value, query: listQuery.value }).href : undefined },
  ...(selected.value ? [{ label: selected.value.name }] : []),
]);
useUnsaved(
  () => dialog.value,
  () => busy.value,
);
</script>
<template>
  <AppLayout :breadcrumbs="breadcrumbs"
    ><main class="connection-ui-page" :class="{ 'connection-ui-list-page': !selected, 'connection-ui-detail-page': !!selected }">
      <nav
        v-if="!admin && !projectID"
        class="connection-ui-tabs"
        aria-label="个人设置分类"
      >
        <RouterLink to="/account">个人资料</RouterLink
        ><RouterLink to="/account/security">账号安全</RouterLink
        ><RouterLink to="/account/integrations"
          >集成凭证</RouterLink><RouterLink to="/account/remote-hosts" class="active">SSH 凭证</RouterLink>
      </nav>
      <div v-if="error" class="error-banner" role="alert">
        {{ error }} <ElButton link @click="load">重新加载</ElButton>
      </div>
      <p v-if="loading" role="status">正在加载{{scopeLabel}}…</p>
      <template v-else-if="!selected && !error">
        <p v-if="!admin">{{ projectID ? '维护本项目使用的SSH 凭证。' : '维护仅属于你自己的SSH 凭证。' }}</p>
        <div class="connection-ui-browser" style="grid-template-columns: minmax(0, 1fr)">

          <section class="connection-ui-results" aria-label="主机列表">


            <div class="connection-ui-list-panel panel remote-host-list-panel">
            <div class="connection-ui-filters table-toolbar console-list-toolbar">
              <ElInput class="connection-ui-search" v-model="query" clearable :placeholder="`搜索${resourceLabel}名称、编码或说明`" :aria-label="`搜索${resourceLabel}`" />
              <ElSelect v-model="statusFilter" placeholder="全部状态" aria-label="主机状态筛选">
                <ElOption label="全部状态" value="" /><ElOption label="已启用" value="enabled" /><ElOption label="已停用" value="disabled" />
              </ElSelect>
              <ElButton v-if="admin" class="connection-ui-create" type="primary" :disabled="!types.length" @click="openCreate"><UiIcon name="plus" />添加{{ resourceLabel }}</ElButton>
            </div>
            <div v-if="!visible.length" class="connection-ui-empty">
              <h3>{{ items.length ? `没有匹配的${resourceLabel}` : "添加第一台远程主机" }}</h3>
              <p>{{ items.length ? "尝试更换状态或搜索关键词。" : admin ? "添加 SSH 主机后，配置登录凭证和主机公钥。" : "请联系系统管理员添加远程主机。" }}</p>
              <ClearFiltersButton v-if="items.length" @click="resetFilters" />
              <ElButton v-else-if="admin" :disabled="!types.length" @click="openCreate">添加{{ resourceLabel }}</ElButton>
            </div>
            <div v-if="visible.length" class="connection-ui-table-wrap">
              <table class="connection-ui-table connection-ui-instances-table">
                <thead><tr><th>{{resourceLabel}}名称</th><th>协议</th><th>说明</th><th>状态</th><th class="connection-ui-actions-column">操作</th></tr></thead>
                <tbody><tr v-for="item in pagedConnections" :key="item.id">
                  <td><div class="connection-ui-instance-identity"><ServiceIcon :type="item.service_type" /><div class="connection-ui-instance-text"><button class="connection-ui-instance-name" @click="choose(item)">{{ item.name }}</button><ConnectionCode :code="item.code" /></div></div></td>
                  <td data-label="服务类型">{{ filterTypes.find(t => t.service_type === item.service_type)?.name ?? item.service_type }}</td>
                  <td data-label="说明"><span class="connection-ui-instance-description" :title="item.description">{{ item.description || '未填写说明' }}</span></td>
                  <td data-label="状态"><span class="connection-ui-status" :class="{ enabled: item.enabled }">{{ item.enabled ? '已启用' : '已停用' }}</span></td>
                  <td class="connection-ui-actions-column"><button class="connection-ui-open" :aria-label="`${admin ? `管理${resourceLabel}` : '管理凭证'}：${item.name}`" :title="admin ? `管理${resourceLabel}` : '管理凭证'" @click="choose(item)"><UiIcon name="chevron" /></button></td>
                </tr></tbody>
              </table>
            </div>
            <div class="table-footer connection-ui-pagination"><div class="list-page-summary"><span>共 {{ visible.length }} 台主机</span><PageSizeSelect v-model="pageSize" /></div><div class="pagination"><button class="page-button" :disabled="page <= 1" aria-label="上一页" @click="page--"><UiIcon name="chevron-left" /></button><span>{{ page }} / {{ pageCount }}</span><button class="page-button" :disabled="page >= pageCount" aria-label="下一页" @click="page++"><UiIcon name="chevron" /></button></div></div>
            </div>
          </section>
        </div>
      </template>
      <template v-else-if="selected && !loading">
        <div class="connection-ui-toolbar connection-ui-detail-header">
          <div class="connection-ui-detail-identity"><ServiceIcon :type="selected.service_type" /><div>
            <h1>
              {{ selected.name }}
              <span class="connection-ui-badge">{{
                selected.enabled ? "已启用" : "已停用"
              }}</span>
            </h1>
            <ConnectionCode :code="selected.code" />
          </div></div>
          <div v-if="admin" class="connection-ui-actions">
            <ElDropdown trigger="click" @command="detailAction">
              <button class="icon-btn" :disabled="busy" :aria-label="`${resourceLabel}更多操作`" title="更多操作"><UiIcon name="more" /></button>
              <template #dropdown><ElDropdownMenu><ElDropdownItem command="toggle"><UiIcon name="power" />{{ selected.enabled ? '停用主机' : '启用主机' }}</ElDropdownItem><ElDropdownItem command="delete" class="connection-ui-danger-action"><UiIcon name="delete" />删除{{ resourceLabel }}</ElDropdownItem></ElDropdownMenu></template>
            </ElDropdown>
          </div>
        </div>
        <nav v-if="admin" class="connection-ui-tabs" aria-label="连接配置">
          <button
            :aria-pressed="tab === 'connection'"
            :class="{ active: tab === 'connection' }"
            @click="tab = 'connection'"
          >
            主机配置</button
          ><button
            v-if="capability?.credentials"
            :aria-pressed="tab === 'credentials'"
            :class="{ active: tab === 'credentials' }"
            @click="tab = 'credentials'"
          >
            系统凭证</button
          ><button :class="{ active: tab === 'hostkeys' }" :aria-pressed="tab === 'hostkeys'" @click="tab = 'hostkeys'">主机公钥</button>
        </nav>

        <div class="connection-ui-detail-body" :class="{ 'connection-ui-credentials-body': tab === 'credentials' }">
        <CredentialsPanel
          v-if="capability?.credentials"
          v-show="tab === 'credentials'"
          :key="credentialsPath"
          :base="credentialsPath"
          :service-type="selected.service_type"
          :system="admin"
          :readonly="readonly"
          :connection-enabled="selected.enabled"
        />
        <component
          :is="serviceUI[selected.service_type]?.settings"
          v-if="admin && serviceUI[selected.service_type]"
          :key="providerPath"
          v-show="tab === 'connection'"
          :base="providerPath"
          :connection="selected"
          :etag="tag"
          @saved="connectionSaved"
        />
        <SSHHostKeys v-if="admin" v-show="tab === 'hostkeys'" :base="providerPath" :connection="selected" :etag="tag" @saved="connectionSaved" />

        </div>
      </template>
      <ElDialog v-model="dialog" title="添加远程主机" width="min(720px, 96vw)" class="connection-ui-dialog" :close-on-click-modal="false" :before-close="closeCreate" :show-close="!busy" :close-on-press-escape="!busy" @closed="credentialValues = {}">
        <ol class="connection-ui-steps" aria-label="创建进度"><li v-for="(label, index) in ['主机信息', '首个凭证']" :key="label" :class="{ active: step === index + 2, complete: step > index + 2 }" :aria-current="step === index + 2 ? 'step' : undefined"><span>{{ index + 1 }}</span>{{ label }}</li></ol>
        <form id="create-connection" class="connection-ui-form connection-ui-wizard-body" @submit.prevent="step < 3 ? nextStep() : save()">
          <div v-if="formError" class="error-banner" role="alert">{{ formError }}</div>

          <template v-if="step === 2">
            <div class="connection-ui-form-pair"><label>{{ resourceLabel }}名称<ElInput v-model="form.name" maxlength="100" /></label>
            <label>编码（可选）<ElInput v-model="form.code" maxlength="64" /></label></div>
            <ProviderFields :show-help="false" v-model="providerValues" :fields="serviceUI.ssh!.connectionFields" />
            <details class="connection-ui-form-more"><summary>更多设置 · 说明</summary><label>说明<ElInput v-model="form.description" type="textarea" :rows="2" maxlength="1000" /></label></details>
          </template>
          <template v-else>
            <div class="connection-ui-wizard-summary"><ServiceIcon :type="form.service_type" /><div><strong>{{ form.name }}</strong><small>{{ `${providerValues.host}:${providerValues.port ?? 22}` }}</small></div><span v-if="createdConnection">已创建</span></div>

              <div class="connection-ui-form-pair"><label>凭证名称<ElInput v-model="credential.name" maxlength="100" :disabled="busy" /></label><label>编码（可选）<ElInput v-model="credential.code" maxlength="64" :disabled="busy" /></label></div>
              <label v-if="form.service_type === 'ssh'">认证方式<ElSelect v-model="authMethod" :disabled="busy"><ElOption value="ssh_password" label="密码" /><ElOption value="ssh_private_key" label="SSH 私钥" /><ElOption value="ssh_encrypted_key" label="带口令私钥" /></ElSelect></label>
<ProviderFields :show-help="false" v-model="credentialValues" :fields="credentialAdapter.identityFields" :disabled="busy" />
              <ProviderFields :show-help="false" v-model="credentialValues" :fields="credentialAdapter.secretFields" :disabled="busy" />
              <label>到期时间（本地时间，可选）<input v-model="credential.expires_at" type="datetime-local" :disabled="busy" /></label>
          </template>
        </form>
        <template #footer><div class="connection-ui-wizard-footer"><ElButton :disabled="busy" @click="closeCreate()">{{ createdConnection ? '进入主机详情' : '取消' }}</ElButton><div><ElButton v-if="step > 2 && !createdConnection" :disabled="busy" @click="step--; formError = ''">上一步</ElButton><ElButton v-if="step === 3" :disabled="busy" @click="save(true)">{{ createdConnection ? '跳过，进入详情' : `仅创建${resourceLabel}` }}</ElButton><ElButton type="primary" native-type="submit" form="create-connection" :loading="busy">{{ step < 3 ? '下一步' : createdConnection ? '重试添加凭证' : `创建${resourceLabel}和凭证` }}</ElButton></div></div></template>
      </ElDialog>
    </main></AppLayout
  >
</template>
