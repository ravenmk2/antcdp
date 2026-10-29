<script setup lang="ts">
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
import { serviceUI } from "./providers";
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
  query = ref(""),
  typeFilter = ref(String(route.query.type ?? "")),
  statusFilter = ref(""),
  tab = ref("connection"),
  tag = ref(""),
  readonly = ref(false),
  projectName = ref("");
const dialog = ref(false),
  formError = ref("");
const providerValues = ref<Record<string, string>>({});
const form = reactive({
  service_type: "",
  code: "",
  name: "",
  description: "",
});
watch(
  () => form.service_type,
  () => {
    providerValues.value = {};
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
watch(typeFilter, (value) => { void router.replace({ query: { ...route.query, type: value || undefined } }); });
watch(() => route.query.type, (value) => { typeFilter.value = typeof value === "string" ? value : ""; });
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
    query: { type: typeFilter.value || undefined },
  });
}
function openCreate() {
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
async function save() {
  if (busy.value) return;
  formError.value = "";
  if (!form.name.trim()) {
    formError.value = "请输入连接名称";
    return;
  }
  busy.value = true;
  try {
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
      dialog.value = false;
      busy.value = false;
      choose(r.data);
      ElMessage.success("连接已创建");
      return;
  } catch (e) {
    formError.value = message(e);
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
  { label: scopeLabel.value, to: selected.value || typeFilter.value ? listPath.value : undefined },
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
    ><main class="integrations-page">
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
        <div class="integration-toolbar">
          <div>
            <p>
              {{
                admin
                  ? "管理外部服务的接入配置、凭证和入站事件。"
                  : projectID
                    ? "维护本项目使用的外部服务凭证。"
                    : "维护仅属于你自己的外部服务凭证。"
              }}
            </p>
          </div>
          <ElButton
            v-if="admin"
            type="primary"
            :disabled="!types.length"
            @click="openCreate"
            >添加连接</ElButton
          >
        </div>
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
              <ElInput v-model="query" clearable placeholder="搜索连接名称、编码或说明" aria-label="搜索连接" />
              <ElSelect v-model="statusFilter" placeholder="全部状态" aria-label="连接状态筛选">
                <ElOption label="全部状态" value="" /><ElOption label="已启用" value="enabled" /><ElOption label="已停用" value="disabled" />
              </ElSelect>
            </div>
            <div v-if="!visible.length" class="integration-empty">
              <h3>{{ items.length ? '没有匹配的连接' : '连接你的第一个服务' }}</h3>
              <p>{{ items.length ? '尝试更换服务类型、状态或搜索关键词。' : admin ? '添加服务连接后，即可配置凭证和事件接收。' : '请联系系统管理员添加服务连接。' }}</p>
              <ClearFiltersButton v-if="items.length" @click="resetFilters" />
              <ElButton v-else-if="admin" :disabled="!types.length" @click="openCreate">添加连接</ElButton>
            </div>
            <div v-if="visible.length" class="integration-table-wrap">
              <table class="integration-table instances-table">
                <thead><tr><th>连接名称</th><th>服务类型</th><th>说明</th><th>状态</th><th class="actions-column">操作</th></tr></thead>
                <tbody><tr v-for="item in visible" :key="item.id">
                  <td><div class="instance-identity"><ServiceIcon :type="item.service_type" /><div class="instance-text"><button class="instance-name" @click="choose(item)">{{ item.name }}</button><ConnectionCode :code="item.code" /></div></div></td>
                  <td data-label="服务类型">{{ filterTypes.find(t => t.service_type === item.service_type)?.name ?? item.service_type }}</td>
                  <td data-label="说明"><span class="instance-description" :title="item.description">{{ item.description || '未填写说明' }}</span></td>
                  <td data-label="状态"><span class="integration-status" :class="{ enabled: item.enabled }">{{ item.enabled ? '已启用' : '已停用' }}</span></td>
                  <td class="actions-column"><ElButton link @click="choose(item)">{{ admin ? '管理连接' : '管理凭证' }} →</ElButton></td>
                </tr></tbody>
              </table>
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
            <ConnectionCode :code="selected.code" /><p>{{ selected.description }}</p>
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
      <ElDialog
        v-model="dialog"
        :title="
          types.length === 1
              ? '添加 ' + types[0]?.name + ' 连接'
              : '添加服务连接'
        "
        width="min(600px, 94vw)"
        :close-on-click-modal="false"
        :show-close="!busy"
        :close-on-press-escape="!busy"
      >
        <form class="integration-form" @submit.prevent="save">
          <div v-if="formError" class="error-banner" role="alert">
            {{ formError }}
          </div>
          <label v-if="types.length > 1"
            >服务类型<ElSelect v-model="form.service_type"
              ><ElOption
                v-for="type in types"
                :key="type.service_type"
                :value="type.service_type"
                :label="type.name" /></ElSelect></label
          ><label>编码（可选）<ElInput v-model="form.code" maxlength="64" :disabled="busy" /><small>全局唯一，创建后不可修改；留空自动生成。</small></label><label
            >名称<ElInput
              v-model="form.name"
              maxlength="100"
              :disabled="busy" /></label
          ><label
            >说明<ElInput
              v-model="form.description"
              type="textarea"
              maxlength="1000"
              :disabled="busy" /></label
          ><ProviderFields
            v-if="serviceUI[form.service_type]"
            v-model="providerValues"
            :fields="serviceUI[form.service_type]!.connectionFields"
            :disabled="busy"
          />
          <div class="integration-actions">
            <ElButton :disabled="busy" @click="dialog = false">取消</ElButton
            ><ElButton native-type="submit" type="primary" :loading="busy">创建连接</ElButton>
          </div>
        </form>
      </ElDialog>
    </main></AppLayout
  >
</template>
