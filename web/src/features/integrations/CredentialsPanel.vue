<script setup lang="ts">
import { serviceUI } from "./providers";
import ProviderFields from "./ProviderFields.vue";
import { useUnsaved } from "./unsaved";
import { computed, reactive, ref, watch } from "vue";
import {
  ElButton,
  ElDialog,
  ElInput,
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
  diagnosticLabels,
  type Credential,
  type Diagnostic,
} from "./types";
const props = defineProps<{
  base: string;
  serviceType: string;
  system?: boolean;
  readonly?: boolean;
  integrationEnabled: boolean;
}>();
const adapter = computed(() => serviceUI[props.serviceType]!);
const providerValues = ref<Record<string, string>>({});
const clearSecret = () => {
  for (const field of adapter.value.secretFields)
    providerValues.value[field.key] = "";
};
const rows = ref<Credential[]>([]),
  loading = ref(true),
  busy = ref(false),
  error = ref(""),
  collection = ref(""),
  defaultID = ref<string | null>(null),
  defaultTag = ref("");
const dialog = ref(false),
  mode = ref<"create" | "edit" | "secret">("create"),
  selected = ref<Credential>(),
  editTag = ref(""),
  formError = ref("");
const form = reactive({
  name: "",
  description: "",

  enabled: true,
  expires_at: "",
});
const diagnostics = ref<Record<string, Diagnostic>>({});
const integrationBase = computed(() =>
  props.base.replace(/\/credentials$/, ""),
);
let generation = 0;
async function load() {
  const g = ++generation;
  loading.value = true;
  error.value = "";
  try {
    const r = await request<{ items: Credential[]; mutation_version: string }>(
      props.base,
    );
    let def:
      | { data: { credential_id: string | null }; etag: string }
      | undefined;
    if (props.system)
      def = await request(integrationBase.value + "/default-credential");
    if (g !== generation) return;
    rows.value = r.data.items;
    collection.value = r.data.mutation_version;
    if (def) {
      defaultID.value = def.data.credential_id;
      defaultTag.value = def.etag;
    }
  } catch (e) {
    if (g === generation) {
      error.value = message(e);
      rows.value = [];
      collection.value = "";
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
async function open(modeValue: "create" | "edit" | "secret", row?: Credential) {
  formError.value = "";
  mode.value = modeValue;
  selected.value = row;
  providerValues.value = { ...row?.identity_config };
  clearSecret();
  Object.assign(form, {
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
      const r = await request<Credential>(props.base + "/" + row.id);
      selected.value = r.data;
      editTag.value = r.etag;
      Object.assign(form, {
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
    formError.value = "请输入凭证名称";
    return;
  }
  if (
    mode.value !== "edit" &&
    adapter.value.validateSecret(providerValues.value)
  ) {
    formError.value = adapter.value.validateSecret(providerValues.value);
    return;
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
          name: form.name,
          description: form.description,
          auth_method: adapter.value.authMethod,
          identity_config: adapter.value.identityBody(providerValues.value),
          secret: adapter.value.secretBody(providerValues.value),
          expires_at: expires,
        },
      });
    else if (mode.value === "secret")
      await request(props.base + "/" + selected.value!.id + "/secret", {
        method: "PUT",
        etag: editTag.value,
        body: adapter.value.secretBody(providerValues.value),
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
    dialog.value = false;
    clearSecret();
    await load();
    ElMessage.success("凭证已保存");
  } catch (e) {
    formError.value = message(e);
  } finally {
    busy.value = false;
  }
}
async function action(kind: string, row: Credential) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    if (kind === "delete") {
      await ElMessageBox.confirm(
        `删除“${row.name}”？首选或默认引用也会清除。`,
        "删除凭证",
        {
          type: "warning",
          confirmButtonText: "删除",
          cancelButtonText: "取消",
        },
      );
      const r = await request<Credential>(props.base + "/" + row.id);
      await request(props.base + "/" + row.id, {
        method: "DELETE",
        etag: r.etag,
        body: { expected_collection_version: collection.value },
      });
    }
    if (kind === "preferred")
      await request(props.base + "/preferred", {
        method: row.is_preferred ? "DELETE" : "PUT",
        etag: collection.value,
        body: row.is_preferred ? undefined : { credential_id: row.id },
      });
    if (kind === "default")
      await request(integrationBase.value + "/default-credential", {
        method: defaultID.value === row.id ? "DELETE" : "PUT",
        etag: defaultTag.value,
        body:
          defaultID.value === row.id ? undefined : { credential_id: row.id },
      });
    if (kind === "verify") {
      const r = await request<{ diagnostic: Diagnostic }>(
        props.base + "/" + row.id + "/verify",
        { method: "POST" },
      );
      diagnostics.value[row.id] = r.data.diagnostic;
    }
    await load();
  } catch (e) {
    if (e !== "cancel" && e !== "close") error.value = message(e);
  } finally {
    busy.value = false;
  }
}
async function last(row: Credential) {
  try {
    const r = await request<Diagnostic | null>(
      props.base + "/" + row.id + "/diagnostics",
    );
    if (r.data) diagnostics.value[row.id] = r.data;
    else ElMessage.info("尚无验证记录");
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
  <section class="integration-section">
    <div class="integration-toolbar">
      <div>
        <h2>{{ system ? "系统凭证" : "凭证" }}</h2>
        <p>
          首选在当前归属内优先使用。{{
            system ? "默认凭证用于后续缺失时回退。" : "秘密保存后不可读取。"
          }}
        </p>
      </div>
      <ElButton
        v-if="!readonly"
        type="primary"
        :disabled="busy || loading || !collection"
        @click="open('create')"
        >添加凭证</ElButton
      >
    </div>
    <p v-if="readonly" class="integration-note">项目已归档，凭证只读。</p>
    <div v-if="error" class="error-banner" role="alert">
      {{ error }} <ElButton link @click="load">重新加载</ElButton>
    </div>
    <p v-if="loading" role="status">正在加载凭证…</p>
    <div v-else-if="!rows.length && !error" class="integration-empty">
      尚未添加凭证。每个归属可维护多份独立身份。
    </div>
    <article v-for="row in rows" :key="row.id" class="credential-row">
      <div class="integration-toolbar">
        <div>
          <h3>
            {{ row.name }}
            <span v-if="row.is_preferred" class="integration-badge">首选</span>
            <span v-if="defaultID === row.id" class="integration-badge"
              >默认 · 缺失时回退</span
            >
          </h3>
          <p>{{ row.description || "未填写说明" }}</p>
          <small
            >{{
              !row.enabled
                ? "已停用"
                : !available(row)
                  ? "已过期或不可用"
                  : "已启用"
            }}
            · {{ adapter.authLabel }} · 秘密{{
              row.has_secret ? "已配置" : "未配置"
            }}
            <template v-if="row.expires_at">
              · 到期 {{ new Date(row.expires_at).toLocaleString() }}</template
            ></small
          >
        </div>
      </div>
      <div class="integration-actions">
        <template v-if="!readonly">
          <ElButton link :disabled="busy" @click="open('edit', row)"
            >编辑</ElButton
          >
          <ElButton link :disabled="busy" @click="open('secret', row)"
            >替换秘密</ElButton
          >
          <ElButton
            link
            :disabled="busy || !available(row) || !integrationEnabled"
            @click="action('verify', row)"
            >验证凭证</ElButton
          >
          <ElDropdown
            trigger="click"
            @command="(command: string) => action(command, row)"
          >
            <ElButton link :disabled="busy">更多操作</ElButton>
            <template #dropdown
              ><ElDropdownMenu>
                <ElDropdownItem
                  command="preferred"
                  :disabled="!row.is_preferred && !available(row)"
                  >{{
                    row.is_preferred ? "取消首选" : "设为首选"
                  }}</ElDropdownItem
                >
                <ElDropdownItem
                  v-if="system"
                  command="default"
                  :disabled="defaultID !== row.id && !available(row)"
                  >{{
                    defaultID === row.id ? "清除默认" : "设为默认"
                  }}</ElDropdownItem
                >
                <ElDropdownItem command="delete" divided
                  >删除凭证</ElDropdownItem
                >
              </ElDropdownMenu></template
            >
          </ElDropdown>
        </template>
        <ElButton link @click="last(row)">最近验证</ElButton>
      </div>
      <p v-if="diagnostics[row.id]" class="integration-note">
        {{
          diagnostics[row.id]!.outdated
            ? "历史结果（配置或材料已变化） · "
            : ""
        }}{{ diagnosticLabels[diagnostics[row.id]!.status] }}
        <template v-if="diagnostics[row.id]!.username">
          · {{ diagnostics[row.id]!.username }}</template
        >
        · {{ new Date(diagnostics[row.id]!.started_at).toLocaleString() }}
      </p>
    </article>
    <ElDialog
      v-model="dialog"
      :title="
        mode === 'create'
          ? '添加凭证'
          : mode === 'secret'
            ? '替换凭证秘密'
            : '编辑凭证'
      "
      width="min(560px, 94vw)"
      :close-on-click-modal="false"
      :close-on-press-escape="!busy"
      :show-close="!busy"
      @closed="clearSecret"
    >
      <form class="integration-form" @submit.prevent="save">
        <div v-if="formError" class="error-banner" role="alert">
          {{ formError }}
        </div>
        <template v-if="mode !== 'secret'"
          ><label
            >名称<ElInput
              v-model="form.name"
              maxlength="100"
              :disabled="busy"
              autocomplete="off" /></label
          ><label
            >说明<ElInput
              v-model="form.description"
              type="textarea"
              maxlength="1000"
              :disabled="busy" /></label
          ><ProviderFields
            v-if="mode === 'create'"
            v-model="providerValues"
            :fields="adapter.identityFields"
            :disabled="busy" /><label
            >到期时间（本地时间，可选）<input
              v-model="form.expires_at"
              type="datetime-local"
              :disabled="busy" /></label
          ><label v-if="mode === 'edit'"
            >启用<ElSwitch v-model="form.enabled" :disabled="busy" /></label
        ></template>
        <ProviderFields
          v-if="mode !== 'edit'"
          v-model="providerValues"
          :fields="adapter.secretFields"
          :disabled="busy"
        />
        <div class="integration-actions">
          <ElButton :disabled="busy" @click="dialog = false">取消</ElButton
          ><ElButton type="primary" native-type="submit" :loading="busy"
            >保存</ElButton
          >
        </div>
      </form>
    </ElDialog>
  </section>
</template>
