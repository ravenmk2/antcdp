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
import WebhookSettings from "./WebhookSettings.vue";
import { serviceUI, authenticationUI } from "./providers";
import ProviderFields from "./ProviderFields.vue";
import { request } from "../../shared/api";
import { message, type Capability, type ServiceConnection } from "./types";
import "./integrations.css";
const route = useRoute(),
  router = useRouter();
const admin = computed(() => route.path.startsWith("/admin/"));
const projectID = computed(() => String(route.params.projectID ?? ""));
const scopeLabel = computed(() =>
  admin.value ? "服务集成" : projectID.value ? "项目集成凭证" : "个人集成凭证",
);
const items = ref<ServiceConnection[]>([]),
  types = ref<Capability[]>([]),
  selected = ref<ServiceConnection>(),
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
const step = ref(1), typeSearch = ref("");
const matchingTypes = computed(() => types.value.filter(t => `${t.name} ${t.service_type}`.toLowerCase().includes(typeSearch.value.trim().toLowerCase())));
const createdConnection = ref<ServiceConnection>();
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
    if (!form.name.trim()) { formError.value = "请输入连接名称"; return; }
    try { const url = new URL(providerValues.value.base_url ?? ""); if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error(); }
    catch { formError.value = "请输入有效的 HTTP 或 HTTPS 实例地址，且不要包含用户名和密码"; return; }
    if (form.code && !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(form.code)) { formError.value = "编码须以小写字母或数字开头，仅含小写字母、数字、下划线或短横线，最长 64 位"; return; }
  }
  step.value++;
}
const providerValues = ref<Record<string, string>>({});
const authMethod = ref("elasticsearch_basic");
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
    providerValues.value = _value === "openobserve" ? { default_organization: "default" } : {};
    credentialValues.value = {};
  },
);
const id = computed(() => String(route.params.integrationID ?? ""));
const capability = computed(() =>
  types.value.find((t) => t.service_type === selected.value?.service_type),
);
const providerPath = computed(() =>
  selected.value
    ? `/admin/service-connections/${selected.value.service_type}/${selected.value.id}`
    : "",
);
const credentialsPath = computed(() =>
  selected.value
    ? `${admin.value ? "/admin" : projectID.value ? "/projects/" + projectID.value : "/me"}/service-connections/${selected.value.service_type}/${selected.value.id}/credentials`
    : "",
);
const filterTypes = computed(() => {
  const names = new Map(types.value.map((t) => [t.service_type, t.name]));
  for (const item of items.value) if (!names.has(item.service_type)) names.set(item.service_type, item.service_type);
  return Array.from(names, ([service_type, name]) => ({
    service_type, name, count: items.value.filter((i) => i.service_type === service_type).length,
  }));
});
const selectedTypeName = computed(() => filterTypes.value.find((t) => t.service_type === typeFilter.value)?.name ?? (typeFilter.value || "全部服务"));
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
      request<{ items: Capability[] }>("/service-types"),
      request<{ items: ServiceConnection[] }>("/service-connections"),
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
    let detail: { data: ServiceConnection; etag: string } | undefined;
    if (id.value && admin.value) {
      const entry = r.data.items.find((v) => v.id === id.value);
      if (!entry) throw new Error("连接不存在");
      detail = await request<ServiceConnection>(
        `/admin/service-connections/${entry.service_type}/${entry.id}`,
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
function choose(item: ServiceConnection) {
  void router.push({
    path: admin.value
      ? `/admin/integrations/${item.id}`
      : projectID.value
        ? `/projects/${projectID.value}/integrations/${item.id}`
        : `/account/integrations/${item.id}`,
    query: listQuery.value,
  });
}
function openCreate() {
  step.value = 1; typeSearch.value = ""; createdConnection.value = undefined;
  credentialValues.value = {}; credential.name = ""; credential.code = ""; credential.expires_at = "";
  providerValues.value = {};
  formError.value = "";
  Object.assign(form, {
    service_type: types.value.find((t) => t.service_type === typeFilter.value)?.service_type ?? types.value[0]?.service_type ?? "",
    code: "",
    name: "",
    description: "",
  });
  dialog.value = true;
}

function connectionSaved(value: ServiceConnection, etag: string) {
  selected.value = value; tag.value = etag;
  const index = items.value.findIndex(item => item.id === value.id);
  if (index >= 0) items.value[index] = value;
}
async function save(skipCredential = false) {
  if (busy.value) return;
  formError.value = "";
  if (!form.name.trim()) {
    formError.value = "请输入连接名称";
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
      const r = await request<ServiceConnection>(
        `/admin/service-connections/${form.service_type}`,
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
        const base = `/admin/service-connections/${form.service_type}/${createdConnection.value.id}/credentials`;
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
      ElMessage.success("连接已创建");
      return;
  } catch (e) {
    for (const field of serviceUI[form.service_type]!.secretFields) credentialValues.value[field.key] = "";
    formError.value = (createdConnection.value ? "连接已创建，凭证未保存。请重新填写认证信息后重试，或暂不添加。" : "") + message(e);
  } finally {
    busy.value = false;
  }
}
async function remove() {
  if (!selected.value) return;
  busy.value = true;
  error.value = "";
  try {
    await ElMessageBox.confirm(
      `删除“${selected.value.name}”？请先移除全部凭证。Webhook 设置和秘密将一并删除，接收地址立即失效，请自行移除远端 Hook。`,
      "删除连接",
      { type: "warning", confirmButtonText: "删除", cancelButtonText: "取消" },
    );
    await request(providerPath.value, {
      method: "DELETE",
      etag: tag.value,
    });
    busy.value = false;
    await router.push("/admin/integrations");
  } catch (e) {
    if (e !== "cancel" && e !== "close") error.value = message(e);
  } finally {
    busy.value = false;
  }
}
const listPath = computed(() =>
  admin.value
    ? "/admin/integrations"
    : projectID.value
      ? `/projects/${projectID.value}/integrations`
      : "/account/integrations",
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
  ...(!projectID.value && (selected.value || typeFilter.value)
    ? [{
        label: selected.value ? capability.value?.name ?? selected.value.service_type : selectedTypeName.value,
        to: selected.value ? `${listPath.value}?type=${encodeURIComponent(selected.value.service_type)}` : undefined,
      }]
    : []),
  ...(selected.value ? [{ label: selected.value.name }] : []),
]);
useUnsaved(
  () => dialog.value,
  () => busy.value,
);
</script>
<template>
  <AppLayout :breadcrumbs="breadcrumbs"
    ><main class="integrations-page" :class="{ 'integration-list-page': !selected, 'integration-detail-page': !!selected }">
      <nav
        v-if="!admin && !projectID"
        class="integration-tabs"
        aria-label="个人设置分类"
      >
        <RouterLink to="/account">个人资料</RouterLink
        ><RouterLink to="/account/security">账号安全</RouterLink
        ><RouterLink to="/account/integrations" class="active"
          >集成凭证</RouterLink
        >
      </nav>
      <div v-if="error" class="error-banner" role="alert">
        {{ error }} <ElButton link @click="load">重新加载</ElButton>
      </div>
      <p v-if="loading" role="status">正在加载服务集成…</p>
      <template v-else-if="!selected && !error">
        <p v-if="!admin">{{ projectID ? '维护本项目使用的外部服务凭证。' : '维护仅属于你自己的外部服务凭证。' }}</p>
        <div class="integration-browser">
          <nav class="service-menu" aria-label="按服务类型筛选">
            <span class="service-menu-title">服务类型</span>
            <button :class="{ active: !typeFilter }" :aria-pressed="!typeFilter" @click="typeFilter = ''">
              <span>全部服务</span><span class="service-count">{{ items.length }}</span>
            </button>
            <button v-for="type in filterTypes" :key="type.service_type"
              :class="{ active: typeFilter === type.service_type }"
              :aria-pressed="typeFilter === type.service_type" @click="typeFilter = type.service_type">
              <span>{{ type.name }}</span><span class="service-count">{{ type.count }}</span>
            </button>
          </nav>
          <section class="integration-results" aria-label="连接列表">
            <div class="service-mobile-filter">
              <label>服务类型<ElSelect v-model="typeFilter" placeholder="全部服务" aria-label="服务类型筛选">
                <ElOption label="全部服务" value="" />
                <ElOption v-for="type in filterTypes" :key="type.service_type" :label="`${type.name}（${type.count}）`" :value="type.service_type" />
              </ElSelect></label>
            </div>
            <div class="integration-result-heading"><h2>{{ selectedTypeName }}</h2><span aria-live="polite">{{ visible.length }} 个连接</span></div>
            <div class="integration-filters">
              <ElInput class="connection-search" v-model="query" clearable placeholder="搜索连接名称、编码或说明" aria-label="搜索连接" />
              <ElSelect v-model="statusFilter" placeholder="全部状态" aria-label="连接状态筛选">
                <ElOption label="全部状态" value="" /><ElOption label="已启用" value="enabled" /><ElOption label="已停用" value="disabled" />
              </ElSelect>
              <ElButton v-if="admin" class="connection-create" type="primary" :disabled="!types.length" @click="openCreate"><UiIcon name="plus" />添加连接</ElButton>
            </div>
            <div class="connection-list-panel">
            <div v-if="!visible.length" class="integration-empty">
              <h3>{{ items.length ? '没有匹配的连接' : '连接你的第一个服务' }}</h3>
              <p>{{ items.length ? '尝试更换服务类型、状态或搜索关键词。' : admin ? '添加服务连接后，即可配置凭证和事件接收。' : '请联系系统管理员添加服务连接。' }}</p>
              <ClearFiltersButton v-if="items.length" @click="resetFilters" />
              <ElButton v-else-if="admin" :disabled="!types.length" @click="openCreate">添加连接</ElButton>
            </div>
            <div v-if="visible.length" class="integration-table-wrap">
              <table class="integration-table instances-table">
                <thead><tr><th>连接名称</th><th>服务类型</th><th>说明</th><th>状态</th><th class="actions-column">操作</th></tr></thead>
                <tbody><tr v-for="item in pagedConnections" :key="item.id">
                  <td><div class="instance-identity"><ServiceIcon :type="item.service_type" /><div class="instance-text"><button class="instance-name" @click="choose(item)">{{ item.name }}</button><ConnectionCode :code="item.code" /></div></div></td>
                  <td data-label="服务类型">{{ filterTypes.find(t => t.service_type === item.service_type)?.name ?? item.service_type }}</td>
                  <td data-label="说明"><span class="instance-description" :title="item.description">{{ item.description || '未填写说明' }}</span></td>
                  <td data-label="状态"><span class="integration-status" :class="{ enabled: item.enabled }">{{ item.enabled ? '已启用' : '已停用' }}</span></td>
                  <td class="actions-column"><button class="connection-open" :aria-label="`${admin ? '管理连接' : '管理凭证'}：${item.name}`" :title="admin ? '管理连接' : '管理凭证'" @click="choose(item)"><UiIcon name="chevron" /></button></td>
                </tr></tbody>
              </table>
            </div>
            <div class="table-footer connection-pagination"><div class="list-page-summary"><span>共 {{ visible.length }} 个连接</span><PageSizeSelect v-model="pageSize" /></div><div class="pagination"><button class="page-button" :disabled="page <= 1" aria-label="上一页" @click="page--"><UiIcon name="chevron-left" /></button><span>{{ page }} / {{ pageCount }}</span><button class="page-button" :disabled="page >= pageCount" aria-label="下一页" @click="page++"><UiIcon name="chevron" /></button></div></div>
            </div>
          </section>
        </div>
      </template>
      <template v-else-if="selected && !loading">
        <div class="integration-toolbar integration-detail-header">
          <div class="integration-detail-identity"><ServiceIcon :type="selected.service_type" /><div>
            <h1>
              {{ selected.name }}
              <span class="integration-badge">{{
                selected.enabled ? "已启用" : "已停用"
              }}</span>
            </h1>
            <ConnectionCode :code="selected.code" /><p v-if="selected.description">{{ selected.description }}</p>
          </div></div>
          <div v-if="admin" class="integration-actions">
            <ElDropdown trigger="click" @command="remove">
              <button class="icon-btn" :disabled="busy" aria-label="连接更多操作" title="更多操作"><UiIcon name="more" /></button>
              <template #dropdown><ElDropdownMenu><ElDropdownItem command="delete" class="connection-danger-action"><UiIcon name="delete" />删除连接</ElDropdownItem></ElDropdownMenu></template>
            </ElDropdown>
          </div>
        </div>
        <nav v-if="admin" class="integration-tabs" aria-label="连接配置">
          <button
            :aria-pressed="tab === 'connection'"
            :class="{ active: tab === 'connection' }"
            @click="tab = 'connection'"
          >
            连接配置</button
          ><button
            v-if="capability?.credentials"
            :aria-pressed="tab === 'credentials'"
            :class="{ active: tab === 'credentials' }"
            @click="tab = 'credentials'"
          >
            系统凭证</button
          ><button
            v-if="capability?.webhook.supported"
            :aria-pressed="tab === 'webhook'"
            :class="{ active: tab === 'webhook' }"
            @click="tab = 'webhook'"
          >
            Webhook 接收设置
          </button>
        </nav>
        <p v-if="!selected.enabled" class="integration-note">此连接已停用。可以继续维护配置与凭证，外部验证和事件接收暂不可用。</p>
        <div class="integration-detail-body" :class="{ 'credentials-body': tab === 'credentials' }">
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
        <WebhookSettings v-if="admin && capability?.webhook.supported" v-show="tab === 'webhook'"
          :key="providerPath + '/webhook'" :base="providerPath + '/webhook'" :connection-enabled="selected.enabled" />
        </div>
      </template>
      <ElDialog v-model="dialog" title="添加服务连接" width="min(720px, 96vw)" class="integration-dialog" :close-on-click-modal="false" :before-close="closeCreate" :show-close="!busy" :close-on-press-escape="!busy" @closed="credentialValues = {}">
        <ol class="connection-steps" aria-label="创建进度"><li v-for="(label, index) in ['选类型', '连接信息', '首个凭证']" :key="label" :class="{ active: step === index + 1, complete: step > index + 1 }" :aria-current="step === index + 1 ? 'step' : undefined"><span>{{ index + 1 }}</span>{{ label }}</li></ol>
        <form id="create-connection" class="integration-form wizard-body" @submit.prevent="step < 3 ? nextStep() : save()">
          <div v-if="formError" class="error-banner" role="alert">{{ formError }}</div>
          <template v-if="step === 1"><ElInput v-model="typeSearch" clearable placeholder="搜索服务类型" aria-label="搜索服务类型" /><div class="service-type-options" role="group" aria-label="选择服务类型">
            <button v-for="type in matchingTypes" :key="type.service_type" type="button" :aria-pressed="form.service_type === type.service_type" @click="form.service_type = type.service_type"><ServiceIcon :type="type.service_type" /><div><strong>{{ type.name }}</strong></div><span class="type-selected" aria-hidden="true">{{ form.service_type === type.service_type ? '✓' : '' }}</span></button>
          </div><p v-if="!matchingTypes.length" role="status">没有匹配的服务类型</p></template>
          <template v-else-if="step === 2">
            <div class="form-pair"><label>连接名称<ElInput v-model="form.name" maxlength="100" /></label>
            <label>编码（可选）<ElInput v-model="form.code" maxlength="64" /></label></div>
            <ProviderFields :show-help="false" v-model="providerValues" :fields="serviceUI[form.service_type]!.connectionFields.filter(f => f.key !== 'custom_ca_pem')" />
            <details class="form-more"><summary>更多设置 · 说明与 TLS</summary><label>说明<ElInput v-model="form.description" type="textarea" :rows="2" maxlength="1000" /></label><ProviderFields :show-help="false" v-model="providerValues" :fields="serviceUI[form.service_type]!.connectionFields.filter(f => f.key === 'custom_ca_pem')" /></details>
          </template>
          <template v-else>
            <div class="wizard-summary"><ServiceIcon :type="form.service_type" /><div><strong>{{ form.name }}</strong><small>{{ providerValues.base_url }}</small></div><span v-if="createdConnection">已创建</span></div>

              <div class="form-pair"><label>凭证名称<ElInput v-model="credential.name" maxlength="100" :disabled="busy" /></label><label>编码（可选）<ElInput v-model="credential.code" maxlength="64" :disabled="busy" /></label></div>
              <label v-if="form.service_type === 'elasticsearch'">认证方式<ElSelect v-model="authMethod" :disabled="busy"><ElOption value="elasticsearch_basic" label="用户名与密码" /><ElOption value="elasticsearch_api_key" label="API Key" /></ElSelect></label>
<ProviderFields :show-help="false" v-model="credentialValues" :fields="credentialAdapter.identityFields" :disabled="busy" />
              <ProviderFields :show-help="false" v-model="credentialValues" :fields="credentialAdapter.secretFields" :disabled="busy" />
              <label>到期时间（本地时间，可选）<input v-model="credential.expires_at" type="datetime-local" :disabled="busy" /></label>
          </template>
        </form>
        <template #footer><div class="wizard-footer"><ElButton :disabled="busy" @click="closeCreate()">{{ createdConnection ? '进入连接详情' : '取消' }}</ElButton><div><ElButton v-if="step > 1 && !createdConnection" :disabled="busy" @click="step--; formError = ''">上一步</ElButton><ElButton v-if="step === 3" :disabled="busy" @click="save(true)">{{ createdConnection ? '跳过，进入详情' : '仅创建连接' }}</ElButton><ElButton type="primary" native-type="submit" form="create-connection" :loading="busy">{{ step < 3 ? '下一步' : createdConnection ? '重试添加凭证' : '创建连接和凭证' }}</ElButton></div></div></template>
      </ElDialog>
    </main></AppLayout
  >
</template>
