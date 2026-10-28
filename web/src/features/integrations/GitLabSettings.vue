<script setup lang="ts">
import { useUnsaved } from "./unsaved";
import { computed, reactive, ref, watch } from "vue";
import {
  ElButton,
  ElInput,
  ElSwitch,
  ElSelect,
  ElOption,
  ElDialog,
  ElMessage,
  ElMessageBox,
} from "element-plus";
import { request } from "../../shared/api";
import { message, diagnosticLabels, type Diagnostic } from "./types";
const props = defineProps<{
  base: string;
  tab: string;
  enabled: boolean;
  integrationID: string;
}>();
interface Config {
  base_url: string;
  custom_ca_pem: string | null;
  webhook_enabled: boolean;
  webhook_verification_method: string;
  has_secret: boolean;
}
const config = ref<Config>(),
  tag = ref(""),
  error = ref(""),
  busy = ref(false),
  loading = ref(true),
  secretDialog = ref(false),
  token = ref(""),
  method = ref("secret_token"),
  oneTime = ref(""),
  secretError = ref("");
const form = reactive({
  base_url: "",
  custom_ca_pem: "",
  webhook_enabled: false,
});
const diagnostic = ref<{
  connection: Diagnostic | null;
  webhook: Diagnostic | null;
}>({ connection: null, webhook: null });
const webhookURL = computed(
  () => `${location.origin}/api/v1/webhooks/gitlab/${props.integrationID}`,
);
const dirty = computed(
  () =>
    config.value &&
    (form.base_url !== config.value.base_url ||
      form.custom_ca_pem !== (config.value.custom_ca_pem ?? "") ||
      form.webhook_enabled !== config.value.webhook_enabled),
);
let generation = 0;
async function load() {
  let g = ++generation;
  loading.value = true;
  error.value = "";
  try {
    const [r, d] = await Promise.all([
      request<Config>(props.base + "/config"),
      request<typeof diagnostic.value>(props.base + "/diagnostics"),
    ]);
    if (g !== generation) return;
    config.value = r.data;
    tag.value = r.etag;
    Object.assign(form, {
      base_url: r.data.base_url,
      custom_ca_pem: r.data.custom_ca_pem ?? "",
      webhook_enabled: r.data.webhook_enabled,
    });
    method.value = r.data.webhook_verification_method;
    diagnostic.value = d.data;
  } catch (e) {
    if (g === generation) {
      error.value = message(e);
      config.value = undefined;
    }
  } finally {
    if (g === generation) loading.value = false;
  }
}
watch(
  () => props.base,
  () => {
    token.value = "";
    oneTime.value = "";
    secretDialog.value = false;
    void load();
  },
  { immediate: true },
);
async function save() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    if (props.tab === "connection" && form.base_url !== config.value?.base_url)
      await ElMessageBox.confirm(
        "修改实例地址会影响该集成下全部归属的凭证验证。",
        "修改连接地址",
        { confirmButtonText: "保存", cancelButtonText: "取消" },
      );
    await request(props.base + "/config", {
      method: "PATCH",
      etag: tag.value,
      body:
        props.tab === "webhook"
          ? { webhook_enabled: form.webhook_enabled }
          : { base_url: form.base_url, custom_ca_pem: form.custom_ca_pem },
    });
    await load();
    ElMessage.success("配置已保存");
  } catch (e) {
    if (e !== "cancel" && e !== "close") error.value = message(e);
  } finally {
    busy.value = false;
  }
}
async function test() {
  busy.value = true;
  error.value = "";
  try {
    await request(props.base + "/test", { method: "POST" });
    diagnostic.value = (
      await request<typeof diagnostic.value>(props.base + "/diagnostics")
    ).data;
  } catch (e) {
    error.value = message(e);
  } finally {
    busy.value = false;
  }
}
function openSecret() {
  secretError.value = "";
  token.value = "";
  method.value = config.value?.webhook_verification_method ?? "secret_token";
  secretDialog.value = true;
}
async function secret(generate: boolean) {
  if (busy.value) return;
  busy.value = true;
  secretError.value = "";
  try {
    if (generate) {
      await ElMessageBox.confirm(
        "生成后原秘密立即失效，所有共用此集成的 GitLab Hook 都需要同步更新。",
        "替换验证秘密",
        { confirmButtonText: "生成并替换", cancelButtonText: "取消" },
      );
    }
    const r = await request<{ token?: string }>(
      props.base + (generate ? "/webhook-secret/generate" : "/webhook-secret"),
      {
        method: generate ? "POST" : "PUT",
        etag: tag.value,
        body: generate
          ? undefined
          : { verification_method: method.value, token: token.value },
      },
    );
    token.value = "";
    secretDialog.value = false;
    await load();
    oneTime.value = r.data.token ?? "";
    ElMessage.success("验证秘密已保存，请同步更新 GitLab 配置");
  } catch (e) {
    if (e !== "cancel" && e !== "close") secretError.value = message(e);
  } finally {
    busy.value = false;
  }
}
async function refreshDiagnostic() {
  try {
    diagnostic.value = (
      await request<typeof diagnostic.value>(props.base + "/diagnostics")
    ).data;
  } catch (e) {
    error.value = message(e);
  }
}
async function refresh() {
  if (dirty.value) {
    try {
      await ElMessageBox.confirm("重新加载将丢弃未保存的配置。", "重新加载", {
        confirmButtonText: "重新加载",
        cancelButtonText: "取消",
      });
    } catch {
      return;
    }
  }
  await load();
}
async function copy(value: string) {
  try {
    if (navigator.clipboard) await navigator.clipboard.writeText(value);
    else {
      const input = document.createElement("textarea");
      input.value = value;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      const copied = document.execCommand("copy");
      input.remove();
      if (!copied) throw new Error("copy failed");
    }
    ElMessage.success("已复制");
  } catch {
    ElMessage.info("浏览器不允许自动复制，请选中文本手动复制");
  }
}
useUnsaved(
  () => !!dirty.value || !!token.value || !!oneTime.value,
  () => busy.value,
);
</script>
<template>
  <section class="integration-section">
    <div v-if="error" class="error-banner" role="alert">
      {{ error }} <ElButton link @click="refresh">重新加载</ElButton>
    </div>
    <p v-if="loading" role="status">正在加载配置…</p>
    <div v-if="!loading && config">
      <form
        v-if="tab === 'connection'"
        class="integration-form"
        @submit.prevent="save"
      >
        <h2>GitLab 连接配置</h2>
        <p>配置实例地址。测试连接不使用任何凭证。</p>
        <label
          >实例地址<ElInput
            v-model="form.base_url"
            placeholder="https://gitlab.example.com"
            maxlength="2048"
            :disabled="busy"
          /><small
            >支持子路径；要求 HTTPS，不允许回环地址或云元数据地址。</small
          ></label
        >
        <details>
          <summary>高级 TLS 配置</summary>
          <label
            >自定义 CA（可选）<ElInput
              v-model="form.custom_ca_pem"
              type="textarea"
              :rows="5"
              maxlength="32768"
              placeholder="-----BEGIN CERTIFICATE-----"
              :disabled="busy"
            /><small
              >用于私有证书颁发机构。始终校验 TLS 证书与主机名。</small
            ></label
          >
        </details>
        <div class="integration-actions">
          <ElButton
            type="primary"
            native-type="submit"
            :disabled="!dirty"
            :loading="busy"
            >保存连接配置</ElButton
          ><ElButton :disabled="busy || !!dirty || !enabled" @click="test"
            >测试已保存连接</ElButton
          >
        </div>
        <p v-if="diagnostic.connection" class="integration-note">
          {{
            diagnostic.connection.outdated
              ? "历史结果（连接配置已变化） · "
              : ""
          }}{{ diagnosticLabels[diagnostic.connection.status] }} ·
          {{ new Date(diagnostic.connection.started_at).toLocaleString() }}
        </p>
      </form>
      <div v-if="tab === 'webhook'">
        <h2>GitLab Webhook</h2>
        <p>
          接收并验证 Push、Tag Push 和 Merge Request 事件。本期不触发工作流。
        </p>
        <ol class="integration-steps">
          <li>配置下方验证秘密；Signing Token 从 GitLab 导入。</li>
          <li>
            在 GitLab 项目或群组的 Settings → Webhooks
            中填入接收地址和相同秘密。
          </li>
          <li>选择支持的事件，启用接收，然后在 GitLab 发送测试事件。</li>
        </ol>
        <label class="integration-form"
          >接收地址<ElInput
            :model-value="webhookURL"
            readonly
            aria-label="Webhook 接收地址" /></label
        ><ElButton link @click="copy(webhookURL)">复制接收地址</ElButton>
        <div class="integration-card">
          <h3>验证秘密</h3>
          <p>
            {{
              config?.webhook_verification_method === "signing_token"
                ? "Signing Token · HMAC-SHA256"
                : "Secret Token · X-Gitlab-Token"
            }}
            · {{ config?.has_secret ? "已配置" : "未配置" }}
          </p>
          <p>
            保存后的秘密不可读取。替换会影响所有共用此集成的
            Hook，不提供双密钥过渡。
          </p>
          <ElButton :disabled="busy" @click="openSecret">{{
            config?.has_secret ? "替换验证秘密" : "配置验证秘密"
          }}</ElButton>
        </div>
        <form class="integration-form" @submit.prevent="save">
          <label
            >启用 Webhook 接收<ElSwitch
              v-model="form.webhook_enabled"
              :disabled="busy || !config?.has_secret" /></label
          ><small v-if="!enabled">整项集成已停用，当前不会接收事件。</small
          ><ElButton
            type="primary"
            native-type="submit"
            :loading="busy"
            :disabled="form.webhook_enabled === config?.webhook_enabled"
            >保存接收状态</ElButton
          >
        </form>
        <div class="integration-card">
          <h3>
            最近接收 <ElButton link @click="refreshDiagnostic">刷新</ElButton>
          </h3>
          <p v-if="diagnostic.webhook">
            {{
              diagnostic.webhook.outdated
                ? "历史结果（接收配置已变化） · "
                : ""
            }}{{ diagnosticLabels[diagnostic.webhook.status] }}<br />{{
              diagnostic.webhook.event
            }}
            · 外部项目 {{ diagnostic.webhook.external_project_id }} ·
            {{ new Date(diagnostic.webhook.started_at).toLocaleString() }}
          </p>
          <p v-else>尚无已验证事件。生成或导入秘密不会自动启用接收。</p>
        </div>
      </div>
    </div>
    <ElDialog
      v-model="secretDialog"
      title="配置 Webhook 验证秘密"
      width="min(560px, 94vw)"
      :close-on-click-modal="false"
      :show-close="!busy"
      :close-on-press-escape="!busy"
      @closed="token = ''"
    >
      <form class="integration-form" @submit.prevent="secret(false)">
        <div v-if="secretError" class="error-banner" role="alert">
          {{ secretError }}
        </div>
        <label
          >验证方式<ElSelect v-model="method" :disabled="busy"
            ><ElOption
              value="secret_token"
              label="Secret Token（兼容旧版 GitLab）" /><ElOption
              value="signing_token"
              label="Signing Token（GitLab 19.0+）" /></ElSelect></label
        ><label
          >新秘密<ElInput
            v-model="token"
            type="password"
            show-password
            autocomplete="new-password"
            :disabled="busy"
        /></label>
        <p>替换后旧秘密立即失效；现有接收开关保持不变。</p>
        <div class="integration-actions">
          <ElButton
            v-if="method === 'secret_token'"
            :disabled="busy"
            @click="secret(true)"
            >生成并保存</ElButton
          ><ElButton
            type="primary"
            native-type="submit"
            :loading="busy"
            :disabled="!token"
            >导入并替换</ElButton
          >
        </div>
      </form>
    </ElDialog>
    <ElDialog
      :model-value="!!oneTime"
      title="请立即保存新秘密"
      width="min(560px, 94vw)"
      :close-on-click-modal="false"
      @update:model-value="oneTime = ''"
    >
      <p>
        仅显示本次生成的明文。关闭后无法再次查看，请填入 GitLab 的 Secret
        Token。
      </p>
      <ElInput
        :model-value="oneTime"
        readonly
        aria-label="本次生成的 Webhook Token"
      /><template #footer
        ><ElButton type="primary" @click="oneTime = ''"
          >已保存，关闭</ElButton
        ></template
      >
    </ElDialog>
  </section>
</template>
