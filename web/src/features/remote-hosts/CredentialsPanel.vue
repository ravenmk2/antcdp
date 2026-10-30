<script setup lang="ts">
import DiagnosticResult from "./DiagnosticResult.vue";
import UiIcon from "../../shared/UiIcon.vue";
import ConnectionCode from "./ConnectionCode.vue";
import ClearFiltersButton from "../../shared/ClearFiltersButton.vue";
import { authenticationUI } from "./providers";
import ProviderFields from "./ProviderFields.vue";
import { useUnsaved } from "./unsaved";
import { computed, reactive, ref, watch, onMounted, onUnmounted } from "vue";
import {
  ElButton,
  ElTabs,
  ElTabPane,
  ElDialog,
  ElInput,
  ElSelect,
  ElOption,
  ElSwitch,
  ElMessage,
  ElMessageBox,
  ElDropdown,
  ElDropdownMenu,
  ElDropdownItem,
} from "element-plus";
import { request } from "../../shared/api";
import {
  available,
  message,
  type HostCredential,
  type Diagnostic,
} from "./types";
const props = defineProps<{
  base: string;
  serviceType: string;
  system?: boolean;
  readonly?: boolean;
  connectionEnabled: boolean;
}>();
const authMethod = ref("");
const adapter = computed(() => authenticationUI(props.serviceType, authMethod.value));
watch(authMethod, () => { providerValues.value = {}; }, { flush: "sync" });
const providerValues = ref<Record<string, string>>({});
const clearSecret = () => {
  for (const field of adapter.value.secretFields)
    providerValues.value[field.key] = "";
};
const rows = ref<HostCredential[]>([]),
  loading = ref(true),
  busy = ref(false),
  error = ref(""),
  collection = ref(""),
  preferredTag = ref(""),
  fallbackID = ref<string | null>(null),
  fallbackTag = ref("");
const formTab = ref("basic");
const dialog = ref(false),
  mode = ref<"create" | "edit" | "secret">("create"),
  selected = ref<HostCredential>(),
  editTag = ref(""),
  formError = ref("");
const form = reactive({
  code: "",
  name: "",
  description: "",

  enabled: true,
  expires_at: "",
});
const search = ref("");
const stateFilter = ref("");
const clock = ref(Date.now());
let clockTimer: ReturnType<typeof setInterval>;
onMounted(() => { clockTimer = setInterval(() => { clock.value = Date.now(); }, 60000); });
onUnmounted(() => clearInterval(clockTimer));
const stateLabels: Record<string, string> = { available: "可用", expiring: "即将到期", expired: "已过期", disabled: "已停用", missing: "未配置秘密" };
function stateOf(row: HostCredential) {
  if (!row.enabled) return "disabled";
  if (!row.has_secret) return "missing";
  const expires = row.expires_at ? Date.parse(row.expires_at) : Infinity;
  if (expires <= clock.value) return "expired";
  return expires - clock.value <= 7 * 86400000 ? "expiring" : "available";
}
function expiryHint(row: HostCredential) {
  if (!row.expires_at) return "";
  const remaining = Date.parse(row.expires_at) - clock.value;
  return remaining <= 0 ? "已过期" : remaining < 86400000 ? "不足 1 天到期" : `${Math.ceil(remaining / 86400000)} 天后到期`;
}
const visibleRows = computed(() => rows.value.filter(row =>
  (!stateFilter.value || stateOf(row) === stateFilter.value) &&
  `${row.name} ${row.code} ${row.description} ${row.identity_config.username ?? ""}`.toLowerCase().includes(search.value.trim().toLowerCase()),
));
const diagnostics = ref<Record<string, Diagnostic | null>>({});
function menuAction(command: string, row: HostCredential) {
  if (command === "edit") void open("edit", row);
  else if (command === "secret") void open("secret", row);
  else if (command === "diagnostics") void last(row);
  else void action(command, row);
}
const connectionBase = computed(() =>
  props.base.replace(/\/credentials$/, ""),
);
let generation = 0;
async function load() {
  const g = ++generation;
  loading.value = true;
  error.value = "";
  try {
    const r = await request<{ items: HostCredential[]; mutation_version: string }>(
      props.base,
    );
    const preferred = await request<{ credential_id: string | null }>(props.base + "/preferred");
    if (preferred.data.credential_id !== (r.data.items.find(row => row.is_preferred)?.id ?? null)) {
      throw new Error("首选设置已变化，请重新加载后操作");
    }
    let def:
      | { data: { credential_id: string | null }; etag: string }
      | undefined;
    if (props.system)
      def = await request(connectionBase.value + "/fallback-credential");
    if (g !== generation) return;
    rows.value = r.data.items;
    collection.value = r.etag;
    preferredTag.value = preferred.etag;
    if (def) {
      fallbackID.value = def.data.credential_id;
      fallbackTag.value = def.etag;
    }
  } catch (e) {
    if (g === generation) {
      error.value = message(e);
      rows.value = [];
      collection.value = "";
      preferredTag.value = "";
    }
  } finally {
    if (g === generation) loading.value = false;
  }
}
watch(
  () => props.base,
  () => {
    dialog.value = false;
    clearSecret();
    diagnostics.value = {};
    void load();
  },
  { immediate: true },
);
async function open(modeValue: "create" | "edit" | "secret", row?: HostCredential) {
  formError.value = "";
  mode.value = modeValue;
  formTab.value = modeValue === "secret" ? "authentication" : "basic";
  selected.value = row;
 authMethod.value = row?.auth_method ?? "ssh_password";
  providerValues.value = { ...row?.identity_config };
  clearSecret();
  Object.assign(form, {
    code: row?.code ?? "",
    name: row?.name ?? "",
    description: row?.description ?? "",

    enabled: row?.enabled ?? true,
    expires_at: row?.expires_at
      ? new Date(
          Date.parse(row.expires_at) -
            new Date(row.expires_at).getTimezoneOffset() * 60000,
        )
          .toISOString()
          .slice(0, 16)
      : "",
  });
  if (row) {
    try {
      const r = await request<HostCredential>(props.base + "/" + row.id);
      selected.value = r.data;
      authMethod.value = r.data.auth_method;
      providerValues.value = { ...r.data.identity_config };
      clearSecret();
      editTag.value = r.etag;
      Object.assign(form, {
        code: r.data.code,
        name: r.data.name,
        description: r.data.description,
        enabled: r.data.enabled,
        expires_at: r.data.expires_at
          ? new Date(
              Date.parse(r.data.expires_at) -
                new Date(r.data.expires_at).getTimezoneOffset() * 60000,
            )
              .toISOString()
              .slice(0, 16)
          : "",
      });
    } catch (e) {
      error.value = message(e);
      return;
    }
  }
  dialog.value = true;
}
async function save() {
  if (busy.value) return;
  formError.value = "";
  if (mode.value !== "secret" && !form.name.trim()) {
    formTab.value = "basic";
    formError.value = "请输入凭证名称";
    return;
  }
  if (
    mode.value !== "edit" &&
    adapter.value.validateSecret(providerValues.value)
  ) {
    formTab.value = "authentication";
    formError.value = adapter.value.validateSecret(providerValues.value);
    return;
  }
  if (
    mode.value === "create" &&
    form.code.trim() &&
    !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(form.code.trim())
  ) {
    formTab.value = "basic";
    formError.value = "编码须以小写字母或数字开头，仅含小写字母、数字、下划线或短横线，最长 64 位";
    return;
  }
  if (mode.value !== "secret" && form.expires_at && !Number.isFinite(Date.parse(form.expires_at))) {
    formTab.value = "lifecycle"; formError.value = "请输入有效的到期时间"; return;
  }
  busy.value = true;
  try {
    const expires = form.expires_at
      ? new Date(form.expires_at).toISOString()
      : null;
    if (mode.value === "create")
      await request(props.base, {
        method: "POST",
        etag: collection.value,
        body: {
          code: form.code,
          name: form.name,
          description: form.description,
          authentication: { auth_method: adapter.value.authMethod,
            identity_config: adapter.value.identityBody(providerValues.value),
            secret: adapter.value.secretBody(providerValues.value) },
          expires_at: expires,
        },
      });
    else if (mode.value === "secret")
      await request(props.base + "/" + selected.value!.id + "/authentication", {
        method: "PUT",
        etag: editTag.value,
        body: { auth_method: adapter.value.authMethod, identity_config: adapter.value.identityBody(providerValues.value), secret: adapter.value.secretBody(providerValues.value) },
      });
    else
      await request(props.base + "/" + selected.value!.id, {
        method: "PATCH",
        etag: editTag.value,
        body: {
          name: form.name,
          description: form.description,
          enabled: form.enabled,
          expires_at: expires,
        },
      });
    if (selected.value) delete diagnostics.value[selected.value.id];
    dialog.value = false;
    clearSecret();
    await load();
    ElMessage.success("凭证已保存");
  } catch (e) {
    clearSecret();
    formError.value = message(e);
  } finally {
    busy.value = false;
  }
}
async function action(kind: string, row: HostCredential) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    if (kind === "delete") {
      await ElMessageBox.confirm(
        `删除“${row.name}”？首选或兜底引用也会清除。`,
        "删除凭证",
        {
          type: "warning",
          confirmButtonText: "删除",
          cancelButtonText: "取消",
        },
      );
      const r = await request<HostCredential>(props.base + "/" + row.id);
      await request(props.base + "/" + row.id, {
        method: "DELETE",
        etag: r.etag,
        headers: { "X-Collection-If-Match": collection.value },
      });
    }
    if (kind === "preferred") {
      await request(props.base + "/preferred", {
        method: row.is_preferred ? "DELETE" : "PUT",
        etag: preferredTag.value,
        body: row.is_preferred ? undefined : { credential_id: row.id },
      });
    }
    if (kind === "fallback")
      await request(connectionBase.value + "/fallback-credential", {
        method: fallbackID.value === row.id ? "DELETE" : "PUT",
        etag: fallbackTag.value,
        body:
          fallbackID.value === row.id ? undefined : { credential_id: row.id },
      });
    if (kind === "verify") {
      const r = await request<Diagnostic>(
        props.base + "/" + row.id + "/verify",
        { method: "POST", etag: `"${row.version}"`, body: {} },
      );
      diagnostics.value[row.id] = r.data;
    }
    await load();
  } catch (e) {
    if (e !== "cancel" && e !== "close") error.value = message(e);
  } finally {
    busy.value = false;
  }
}
async function last(row: HostCredential) {
  try {
    const r = await request<{ latest: Diagnostic | null }>(
      props.base + "/" + row.id + "/diagnostics",
    );
    diagnostics.value[row.id] = r.data.latest;
  } catch (e) {
    error.value = message(e);
  }
}
useUnsaved(
  () => dialog.value,
  () => busy.value,
);
</script>
<template>
  <section class="remote-host-section host-credential-list" aria-label="凭证列表">
    <div class="host-credential-filters table-toolbar console-list-toolbar">
      <ElInput v-model="search" clearable placeholder="搜索名称、编码、用户名或说明" aria-label="搜索凭证" />
      <ElSelect v-model="stateFilter" placeholder="全部状态" aria-label="凭证状态筛选"><ElOption label="全部状态" value="" /><ElOption v-for="(label, value) in stateLabels" :key="value" :label="label" :value="value" /></ElSelect>
      <ElButton v-if="!readonly" class="host-credential-create" type="primary" :disabled="busy || loading || !collection" @click="open('create')"><UiIcon name="plus" />添加凭证</ElButton>
    </div>
    <div class="host-credential-list-content" :aria-busy="loading">
      <p v-if="readonly" class="host-credential-readonly">项目已归档，凭证只读。</p>
      <div v-if="loading" class="host-credential-list-state" role="status">正在加载凭证…</div>
      <div v-else-if="error" class="host-credential-list-state" role="alert">{{ error }}<ElButton @click="load">重新加载</ElButton></div>
      <div v-else-if="!rows.length" class="host-credential-list-state" role="status">尚未添加凭证</div>
      <div v-else-if="!visibleRows.length" class="host-credential-list-state" role="status">没有匹配的凭证<ClearFiltersButton link @click="search = ''; stateFilter = ''" /></div>
      <div v-else class="remote-host-table-wrap">
      <table class="remote-host-table credentials-table">
        <thead><tr><th>凭证名称</th><th>状态</th><th>使用设置</th><th>有效期</th><th>最近验证</th><th class="actions-column">操作</th></tr></thead>
        <tbody><tr v-for="row in visibleRows" :key="row.id">
          <td><strong class="host-credential-name" :title="row.description">{{ row.name }}</strong><ConnectionCode class="host-credential-code" :code="row.code" /><small v-if="row.identity_config.username" class="cell-subtext">用户：{{ row.identity_config.username }}</small><small v-if="serviceType === 'ssh'" class="cell-subtext">{{ {ssh_password:"密码",ssh_private_key:"SSH 私钥",ssh_encrypted_key:"带口令私钥"}[row.auth_method] }}</small><span v-if="row.description" class="host-credential-description" :title="row.description">{{ row.description }}</span></td>
          <td data-label="状态"><span class="host-credential-status" :class="stateOf(row)">{{ stateLabels[stateOf(row)] }}</span></td>
          <td data-label="使用设置"><div><span v-if="row.is_preferred" class="remote-host-badge">首选</span><span v-if="fallbackID === row.id" class="remote-host-badge fallback">兜底</span><span v-if="!row.is_preferred && fallbackID !== row.id" class="muted">—</span></div></td>
          <td data-label="有效期"><div><span :title="row.expires_at ? new Date(row.expires_at).toLocaleString() : ''">{{ row.expires_at ? new Date(row.expires_at).toLocaleDateString() : '未设置' }}</span><small v-if="row.expires_at" class="cell-subtext">{{ expiryHint(row) }}</small></div></td>
          <td data-label="最近验证"><div v-if="diagnostics[row.id]"><DiagnosticResult :diagnostic="diagnostics[row.id]!" /><small v-if="diagnostics[row.id]!.summary.external_identity?.username" class="cell-subtext">{{ diagnostics[row.id]!.summary.external_identity?.username }}</small><small class="cell-subtext">{{ new Date(diagnostics[row.id]!.started_at).toLocaleString() }}</small></div><button v-else-if="diagnostics[row.id] === undefined" class="host-credential-action" :disabled="busy" @click="last(row)">查看记录</button><span v-else class="muted">尚无记录</span></td>
          <td class="actions-column"><div v-if="!readonly" class="host-credential-row-actions"><ElDropdown trigger="click" popper-class="host-credential-action-menu" @command="(command: string) => menuAction(command, row)"><button class="host-credential-action host-credential-more" :disabled="busy" :aria-label="`${row.name}更多操作`"><UiIcon name="more" /></button><template #dropdown><ElDropdownMenu>
            <ElDropdownItem command="edit"><UiIcon name="edit" />编辑凭证</ElDropdownItem>
            <ElDropdownItem command="secret"><UiIcon name="key" />替换认证信息</ElDropdownItem>
            <ElDropdownItem command="verify" :disabled="!available(row) || !connectionEnabled"><UiIcon name="shield" />验证凭证</ElDropdownItem>
            <ElDropdownItem command="diagnostics"><UiIcon name="log" />最近验证</ElDropdownItem>
            <ElDropdownItem command="preferred" divided :disabled="!row.is_preferred && !available(row)"><UiIcon name="pin" />{{ row.is_preferred ? '取消首选' : '设为首选' }}</ElDropdownItem>
            <ElDropdownItem v-if="system" command="fallback" :disabled="fallbackID !== row.id && !available(row)"><UiIcon name="layers" />{{ fallbackID === row.id ? '清除兜底' : '设为兜底' }}</ElDropdownItem>
            <ElDropdownItem command="delete" class="host-credential-delete" divided><UiIcon name="delete" />删除凭证</ElDropdownItem>
          </ElDropdownMenu></template></ElDropdown></div><span v-else class="muted">只读</span></td>
        </tr></tbody>
      </table>
      </div>
    </div>
    <div v-if="!loading && !error" class="table-footer"><span aria-live="polite">共 {{ visibleRows.length }} 份凭证</span></div>
    <ElDialog
      v-model="dialog"
      :title="
        mode === 'create'
          ? '添加凭证'
          : mode === 'secret'
            ? '替换凭证认证信息'
            : '编辑凭证'
      "
      width="min(680px, 96vw)"
      class="remote-host-dialog"
      :close-on-click-modal="false"
      :close-on-press-escape="!busy"
      :show-close="!busy"
      @closed="clearSecret"
    >
      <form id="host-credential-editor" novalidate class="remote-host-form host-credential-editor" @submit.prevent="save">
        <div v-if="formError" class="error-banner" role="alert">{{ formError }}</div>
        <ElTabs v-model="formTab" class="host-credential-editor-tabs">
          <ElTabPane v-if="mode !== 'secret'" label="基本信息" name="basic">
            <div class="remote-host-form">
              <div class="host-form-pair"><label>名称<ElInput v-model="form.name" maxlength="100" :disabled="busy" autocomplete="off" /></label><label>编码{{ mode === 'create' ? '（可选）' : '' }}<ElInput v-model="form.code" maxlength="64" :readonly="mode === 'edit'" :disabled="busy" /></label></div>

              <label>说明（可选）<ElInput v-model="form.description" type="textarea" :rows="3" maxlength="1000" :disabled="busy" /></label>
            </div>
          </ElTabPane>
          <ElTabPane v-if="mode !== 'edit'" label="认证信息" name="authentication">
            <div class="remote-host-form"><label v-if="serviceType === 'ssh'">认证方式<ElSelect v-model="authMethod" :disabled="busy"><ElOption value="ssh_password" label="密码" /><ElOption value="ssh_private_key" label="SSH 私钥" /><ElOption value="ssh_encrypted_key" label="带口令私钥" /></ElSelect></label><ProviderFields :show-help="false" v-model="providerValues" :fields="adapter.identityFields" :disabled="busy" /><ProviderFields :show-help="false" v-model="providerValues" :fields="adapter.secretFields" :disabled="busy" /></div>
          </ElTabPane>
          <ElTabPane v-if="mode !== 'secret'" label="有效期与状态" name="lifecycle">
            <div class="remote-host-form"><label>到期时间（本地时间）<input v-model="form.expires_at" type="datetime-local" :disabled="busy" /></label><label v-if="mode === 'edit'">启用凭证<ElSwitch v-model="form.enabled" :disabled="busy" /></label></div>
          </ElTabPane>
        </ElTabs>
      </form>
      <template #footer><div class="host-wizard-footer"><ElButton :disabled="busy" @click="dialog = false">取消</ElButton><ElButton type="primary" native-type="submit" form="host-credential-editor" :loading="busy">{{ mode === 'create' ? '添加凭证' : '保存修改' }}</ElButton></div></template>
    </ElDialog>
  </section>
</template>
