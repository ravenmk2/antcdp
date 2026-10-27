<script setup lang="ts">
import { computed, onUnmounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  ElButton,
  ElDialog,
  ElForm,
  ElFormItem,
  ElInput,
  ElMessage,
} from "element-plus";
import { useFormErrors, validateDisplayName, passwordHelp } from "../../shared/formErrors";
import RequiredPasswordPage from "./RequiredPasswordPage.vue";
import AppLayout from "../../app/AppLayout.vue";
import { request, resetCSRF } from "../../shared/api";
import {
  useIdentity,
  identityLabel,
  validatePassword,
  type User,
} from "./store";
import UserAvatar from "../../shared/UserAvatar.vue";
import UiIcon from "../../shared/UiIcon.vue";
import AvatarEditor from "../media/AvatarEditor.vue";
import { useLogout } from "./logout";
const avatarEditor = ref<InstanceType<typeof AvatarEditor>>();
const avatarChange = ref<string | null>();
const avatarProcessing = ref(false);
const identity = useIdentity();
const { logout, loggingOut } = useLogout();
const route = useRoute();
const router = useRouter();
const security = computed(() => route.path.endsWith("/security"));
const passwordDialog = ref(
  Boolean(identity.session?.require_password_change && security.value),
);
const busy = ref(false);
const { formRef, error, fieldErrors, clearErrors, showError, hasErrors } = useFormErrors(["display_name", "current", "next", "confirm"] as const, { current_password: "current", new_password: "next" });
const form = reactive({
  display_name: identity.user?.display_name ?? "",
  current: "",
  next: "",
  confirm: "",
});
watch(
  () => route.path,
  () => {
    passwordDialog.value = Boolean(
      identity.session?.require_password_change && security.value,
    );
    avatarEditor.value?.reset();
    avatarChange.value = undefined;
    avatarProcessing.value = false;
    clearErrors();
    form.current = "";
    form.next = "";
    form.confirm = "";
  },
);
async function save() {
  if (busy.value || avatarProcessing.value || !identity.user) return;
  clearErrors();
  if (security.value) {
    if (!form.current) fieldErrors.current = "请输入当前密码。";
    fieldErrors.next = validatePassword(form.next);
    if (form.next !== form.confirm) fieldErrors.confirm = "两次输入的密码不一致。";
  } else fieldErrors.display_name = validateDisplayName(form.display_name);
  if (hasErrors()) return;
  busy.value = true;
  try {
    if (security.value) {
      await request("/account/password", {
        method: "PUT",
        body: { current_password: form.current, new_password: form.next },
      });
      identity.session = null;
      resetCSRF();
      form.current = "";
      form.next = "";
      form.confirm = "";
      ElMessage.success("密码已更新，请重新登录。");
      await router.replace("/login");
    } else {
      const r = await request<User>("/account", {
        method: "PATCH",
        etag: `"u-${identity.user.id}-v${identity.user.version}"`,
        body: {
          display_name: form.display_name,
          ...(avatarChange.value !== undefined
            ? { avatar_upload_id: avatarChange.value }
            : {}),
        },
      });
      avatarEditor.value?.saved();
      if (identity.session) identity.session.user = r.data;
      form.display_name = r.data.display_name;
      ElMessage.success("个人资料已保存。");
    }
  } catch (err) {
    showError(err);
  } finally {
    busy.value = false;
  }
}
function clearPassword() {
  form.current = "";
  form.next = "";
  form.confirm = "";
  clearErrors();
}
onUnmounted(() => {
  form.current = "";
  form.next = "";
  form.confirm = "";
});
</script>
<template>
  <RequiredPasswordPage v-if="identity.session?.require_password_change" />
  <AppLayout v-else>
    <div v-if="identity.user" class="profile-layout">
      <aside class="panel profile-summary">
        <UserAvatar :user="identity.user" large />
        <div>
          <h2>{{ identity.user.display_name }}</h2>
          <p class="username">@{{ identity.user.username }}</p>
        </div>
        <span
          class="badge"
          :class="identity.user.is_founder ? 'founder' : identity.user.role"
          ><UiIcon v-if="identity.isAdmin" name="shield" />{{
            identityLabel(identity.user)
          }}</span
        >
        <div class="summary-line">
          加入于 {{ identity.date(identity.user.created_at) }}<br />{{
            identity.user.is_founder
              ? "你是本系统的创始人"
              : identity.isAdmin
                ? "你可以访问系统控制台"
                : "你的开发协作之旅，从这里开始"
          }}
        </div>
      </aside>
      <section class="panel">
        <nav class="tabs" aria-label="个人设置分类">
          <RouterLink class="tab" to="/account" :class="{ active: !security }"
            >个人资料</RouterLink
          ><RouterLink
            class="tab"
            to="/account/security"
            :class="{ active: security }"
            >账号安全</RouterLink
          >
        </nav>
        <ElForm
          v-if="!security"
          ref="formRef"
          class="field-errors-form"
          label-position="top"
          :disabled="busy"
          @submit.prevent="save"
        >
          <div class="settings-body">
            <div v-if="error" class="error-banner" role="alert">
              {{ error }}
            </div>
            <AvatarEditor
              ref="avatarEditor"
              v-model="avatarChange"
              :avatar="identity.user.avatar"
              :disabled="busy"
              label="个人头像"
              @processing="avatarProcessing = $event"
            />
            <ElFormItem label="显示名称" :error="fieldErrors.display_name" required
              ><ElInput
                v-model="form.display_name"
            @input="fieldErrors.display_name = ''"
                name="display-name"
                autocomplete="nickname"
                maxlength="30" /></ElFormItem
            ><ElFormItem label="用户名"
              ><ElInput
                :model-value="identity.user.username"
                name="username"
                autocomplete="username"
                readonly
            /></ElFormItem>
            <p class="field-help">用户名用于登录，当前阶段由管理员维护。</p>
          </div>
          <div class="settings-save">
            <span>你的系统身份：{{ identityLabel(identity.user) }}</span
            ><ElButton
              type="primary"
              native-type="submit"
              :loading="busy"
              :disabled="busy || avatarProcessing"
              >保存资料</ElButton
            >
          </div>
        </ElForm>
        <div v-else class="settings-body">
          <div
            v-if="error && !passwordDialog"
            class="error-banner"
            role="alert"
          >
            {{ error }}
          </div>
          <div
            v-if="identity.session?.require_password_change"
            class="inline-alert warning"
          >
            <UiIcon name="shield" /><span
              >此账号使用管理员设置的密码，请先修改密码后继续使用系统。</span
            >
          </div>
          <div class="security-row">
            <div>
              <h3>登录密码</h3>
              <p>定期更新密码，保护你的账号。</p>
            </div>
            <ElButton @click="passwordDialog = true"
              ><UiIcon name="key" />修改密码</ElButton
            >
          </div>
          <div class="security-row">
            <div>
              <h3>登录会话</h3>
              <p>
                闲置有效期
                {{ identity.session?.session_ttl_days }}
                天，使用时自动续期，退出后立即失效。
              </p>
            </div>
          </div>
          <div class="security-row">
            <div class="session-device">
              <span class="device-icon"><UiIcon name="device" /></span>
              <div>
                <h3>当前浏览器</h3>
                <p>当前设备 · 正在使用</p>
              </div>
            </div>
            <span class="session-current">当前会话</span>
          </div>
          <div class="security-row">
            <div>
              <h3>退出账号</h3>
              <p>结束当前浏览器中的登录会话。</p>
            </div>
            <ElButton :disabled="loggingOut" @click="logout"
              ><UiIcon name="logout" />退出登录</ElButton
            >
          </div>
        </div>
      </section>
    </div>
    <ElDialog
      v-model="passwordDialog"
      destroy-on-close
      class="app-dialog"
      align-center
      title="修改密码"
      width="460px"
      :close-on-click-modal="
        !busy && !identity.session?.require_password_change
      "
      :close-on-press-escape="
        !busy && !identity.session?.require_password_change
      "
      :show-close="!busy && !identity.session?.require_password_change"
      @closed="clearPassword"
    >
      <div
        v-if="identity.session?.require_password_change"
        class="inline-alert warning"
      >
        <UiIcon name="shield" /><span
          >首次登录需要设置新密码，完成后重新登录。</span
        >
      </div>
      <div v-if="error" class="error-banner" role="alert">{{ error }}</div>
      <ElForm ref="formRef" class="field-errors-form" label-position="top" :disabled="busy" @submit.prevent="save"
        ><ElFormItem label="当前密码" :error="fieldErrors.current" required
          ><ElInput
            v-model="form.current"
            @input="fieldErrors.current = ''"
            name="current-password"
            type="password"
            show-password
            autocomplete="current-password" /></ElFormItem
        ><ElFormItem label="新密码" :error="fieldErrors.next" required
          ><ElInput
            v-model="form.next"
            @input="fieldErrors.next = ''"
            name="new-password"
            aria-describedby="account-password-help"
            type="password"
            show-password
            autocomplete="new-password"
        /><p id="account-password-help" class="form-field-help">{{ passwordHelp }}</p></ElFormItem>
        <ElFormItem label="确认新密码" :error="fieldErrors.confirm" required
          ><ElInput
            v-model="form.confirm"
            @input="fieldErrors.confirm = ''"
            name="confirm-password"
            type="password"
            show-password
            autocomplete="new-password"
        /></ElFormItem>
        <div class="inline-alert">
          <UiIcon name="lock" /><span
            >修改后所有登录会话都会失效，需要重新登录。</span
          >
        </div>
        <footer class="form-footer">
          <ElButton
            v-if="!identity.session?.require_password_change"
            :disabled="busy"
            @click="passwordDialog = false"
            >取消</ElButton
          ><ElButton
            type="primary"
            native-type="submit"
            :loading="busy"
            :disabled="busy"
            >更新密码</ElButton
          >
        </footer></ElForm
      >
    </ElDialog>
  </AppLayout>
</template>
