<script setup lang="ts">
import { useUnsaved } from "./unsaved";
import { computed, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  ElButton,
  ElInput,
  ElDialog,
  ElSwitch,
  ElSelect,
  ElOption,
  ElMessageBox,
  ElMessage,
} from "element-plus";
import AppLayout from "../../app/AppLayout.vue";
import CredentialsPanel from "./CredentialsPanel.vue";
import { serviceUI } from "./providers";
import ProviderFields from "./ProviderFields.vue";
import { request } from "../../shared/api";
import { message, type Capability, type Integration } from "./types";
import "./integrations.css";
const route = useRoute(),
  router = useRouter();
const admin = computed(() => route.path.startsWith("/admin/"));
const projectID = computed(() => String(route.params.projectID ?? ""));
const scopeLabel = computed(() =>
  admin.value ? "服务集成" : projectID.value ? "项目集成凭证" : "个人集成凭证",
);
const items = ref<Integration[]>([]),
  types = ref<Capability[]>([]),
  selected = ref<Integration>(),
  loading = ref(true),
  busy = ref(false),
  error = ref(""),
  query = ref(""),
  typeFilter = ref(""),
  tab = ref("connection"),
  tag = ref(""),
  readonly = ref(false),
  projectName = ref("");
const dialog = ref(false),
  editing = ref(false),
  formError = ref("");
const providerValues = ref<Record<string, string>>({});
const form = reactive({
  service_type: "",
  name: "",
  description: "",
  enabled: true,
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
    ? `/admin/integrations/${selected.value.service_type}/${selected.value.id}`
    : "",
);
const credentialsPath = computed(() =>
  selected.value
    ? `${admin.value ? "/admin" : projectID.value ? "/projects/" + projectID.value : "/me"}/integrations/${selected.value.service_type}/${selected.value.id}/credentials`
    : "",
);
const visible = computed(() =>
  items.value.filter(
    (i) =>
      (!typeFilter.value || i.service_type === typeFilter.value) &&
      `${i.name} ${i.description}`
        .toLowerCase()
        .includes(query.value.toLowerCase()),
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
      request<Capability[]>("/integrations/types"),
      request<Integration[]>("/integrations"),
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
    let detail: { data: Integration; etag: string } | undefined;
    if (id.value && admin.value) {
      const entry = r.data.find((v) => v.id === id.value);
      if (!entry) throw new Error("集成不存在");
      detail = await request<Integration>(
        `/admin/integrations/${entry.service_type}/${entry.id}`,
      );
    }
    if (g !== generation) return;
    types.value = t.data.filter((t) => serviceUI[t.service_type]);
    items.value = r.data;
    projectName.value = project?.name ?? "";
    readonly.value = project?.status === "archived";
    if (detail) {
      selected.value = detail.data;
      tag.value = detail.etag;
    } else if (!admin.value && id.value) {
      selected.value = r.data.find((v) => v.id === id.value);
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
function choose(item: Integration) {
  void router.push(
    admin.value
      ? `/admin/integrations/${item.id}`
      : projectID.value
        ? `/projects/${projectID.value}/integrations/${item.id}`
        : `/account/integrations/${item.id}`,
  );
}
function openCreate() {
  editing.value = false;
  providerValues.value = {};
  formError.value = "";
  Object.assign(form, {
    service_type: types.value[0]?.service_type ?? "",
    name: "",
    description: "",
    enabled: true,
  });
  dialog.value = true;
}
function openEdit() {
  if (!selected.value) return;
  editing.value = true;
  formError.value = "";
  Object.assign(form, selected.value);
  dialog.value = true;
}
async function save() {
  if (busy.value) return;
  formError.value = "";
  if (!form.name.trim()) {
    formError.value = "请输入集成名称";
    return;
  }
  busy.value = true;
  try {
    if (editing.value)
      await request(providerPath.value, {
        method: "PATCH",
        etag: tag.value,
        body: {
          name: form.name,
          description: form.description,
          enabled: form.enabled,
        },
      });
    else {
      const r = await request<Integration>(
        `/admin/integrations/${form.service_type}`,
        {
          method: "POST",
          body: {
            name: form.name,
            description: form.description,
            ...serviceUI[form.service_type]!.connectionBody(
              providerValues.value,
            ),
          },
        },
      );
      dialog.value = false;
      busy.value = false;
      choose(r.data);
      ElMessage.success("集成已创建");
      return;
    }
    dialog.value = false;
    await load();
    ElMessage.success("资料已保存");
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
      `删除“${selected.value.name}”？Webhook 接收地址会立即失效。存在任何归属的凭证时无法删除。`,
      "删除集成",
      { type: "warning", confirmButtonText: "删除", cancelButtonText: "取消" },
    );
    const cfg = await request(providerPath.value + "/config");
    await request(providerPath.value, {
      method: "DELETE",
      etag: tag.value,
      body: { expected_config_version: cfg.etag },
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
  { label: scopeLabel.value, to: selected.value ? listPath.value : undefined },
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
            >添加集成</ElButton
          >
        </div>
        <div class="integration-filters">
          <ElInput
            v-model="query"
            clearable
            placeholder="搜索名称或说明"
            aria-label="搜索集成"
          /><ElSelect
            v-if="types.length > 1"
            v-model="typeFilter"
            clearable
            placeholder="全部服务类型"
            aria-label="服务类型"
            ><ElOption
              v-for="type in types"
              :key="type.service_type"
              :label="type.name"
              :value="type.service_type"
          /></ElSelect>
        </div>
        <div v-if="!visible.length" class="integration-empty">
          {{
            items.length
              ? "没有符合条件的集成"
              : "尚无服务集成。" +
                (admin
                  ? "添加服务后即可维护凭证和接入配置。"
                  : "请联系系统管理员添加。")
          }}
        </div>
        <div class="integration-grid">
          <button
            v-for="item in visible"
            :key="item.id"
            class="integration-tile"
            @click="choose(item)"
          >
            <div class="integration-toolbar">
              <span class="integration-provider">{{
                types.find((t) => t.service_type === item.service_type)?.name ??
                item.service_type
              }}</span
              ><span class="integration-badge">{{
                item.enabled ? "已启用" : "已停用"
              }}</span>
            </div>
            <h2>{{ item.name }}</h2>
            <p>{{ item.description || "未填写说明" }}</p>
            <span class="integration-tile-link"
              >{{ admin ? "管理集成" : "管理凭证" }} →</span
            >
          </button>
        </div>
      </template>
      <template v-else-if="selected && !loading">
        <div class="integration-toolbar">
          <div>
            <span class="integration-provider">{{
              capability?.name ?? selected.service_type
            }}</span>
            <h1>
              {{ selected.name }}
              <span class="integration-badge">{{
                selected.enabled ? "已启用" : "已停用"
              }}</span>
            </h1>
            <p>{{ selected.description }}</p>
          </div>
          <div v-if="admin" class="integration-actions">
            <ElButton :disabled="busy" @click="openEdit">编辑资料</ElButton
            ><ElButton :disabled="busy" @click="remove">删除集成</ElButton>
          </div>
        </div>
        <nav v-if="admin" class="integration-tabs" aria-label="集成配置">
          <button
            :class="{ active: tab === 'connection' }"
            @click="tab = 'connection'"
          >
            连接配置</button
          ><button
            v-if="capability?.credentials"
            :class="{ active: tab === 'credentials' }"
            @click="tab = 'credentials'"
          >
            系统凭证</button
          ><button
            v-if="capability?.webhook"
            :class="{ active: tab === 'webhook' }"
            @click="tab = 'webhook'"
          >
            Webhook
          </button>
        </nav>
        <CredentialsPanel
          v-if="capability?.credentials"
          v-show="tab === 'credentials'"
          :key="credentialsPath"
          :base="credentialsPath"
          :service-type="selected.service_type"
          :system="admin"
          :readonly="readonly"
          :integration-enabled="selected.enabled"
        />
        <component
          :is="serviceUI[selected.service_type]?.settings"
          v-if="admin && serviceUI[selected.service_type]"
          :key="providerPath"
          v-show="tab !== 'credentials'"
          :base="providerPath"
          :tab="tab"
          :enabled="selected.enabled"
          :integration-i-d="selected.id"
        />
      </template>
      <ElDialog
        v-model="dialog"
        :title="
          editing
            ? '编辑集成资料'
            : types.length === 1
              ? '添加 ' + types[0]?.name + ' 集成'
              : '添加服务集成'
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
          <label v-if="!editing && types.length > 1"
            >服务类型<ElSelect v-model="form.service_type"
              ><ElOption
                v-for="type in types"
                :key="type.service_type"
                :value="type.service_type"
                :label="type.name" /></ElSelect></label
          ><label
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
            v-if="!editing && serviceUI[form.service_type]"
            v-model="providerValues"
            :fields="serviceUI[form.service_type]!.connectionFields"
            :disabled="busy"
          /><label v-if="editing"
            >启用集成<ElSwitch v-model="form.enabled" :disabled="busy" /><small
              >停用后禁止外部验证与 Webhook 接收，配置和凭证仍可维护。</small
            ></label
          >
          <div class="integration-actions">
            <ElButton :disabled="busy" @click="dialog = false">取消</ElButton
            ><ElButton native-type="submit" type="primary" :loading="busy">{{
              editing ? "保存" : "创建集成"
            }}</ElButton>
          </div>
        </form>
      </ElDialog>
    </main></AppLayout
  >
</template>
