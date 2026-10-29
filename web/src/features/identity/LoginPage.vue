<script setup lang="ts">
import { computed, onUnmounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElButton, ElForm, ElFormItem, ElInput, ElMessage } from "element-plus";
import { useIdentity, validatePassword } from "./store";
import { useFormErrors, validateDisplayName, validateUsername, usernameHelp } from "../../shared/formErrors";
import UiIcon from "../../shared/UiIcon.vue";
import BrandLogo from "../../shared/BrandLogo.vue";
const identity = useIdentity();
const router = useRouter();
const route = useRoute();
const registering = computed(() => route.path === "/register");
const form = reactive({
  username: "",
  display_name: "",
  password: "",
  confirm: "",
});
const busy = ref(false);
const { formRef, error, fieldErrors, clearErrors, showError, hasErrors } = useFormErrors(["username", "display_name", "password", "confirm"] as const);
async function submit() {
  if (busy.value) return;
  clearErrors();
  if (registering.value) {
    fieldErrors.display_name = validateDisplayName(form.display_name);
    fieldErrors.username = validateUsername(form.username);
    fieldErrors.password = validatePassword(form.password);
    if (form.password !== form.confirm) fieldErrors.confirm = "两次输入的密码不一致。";
  } else {
    if (!form.username) fieldErrors.username = "请输入用户名。";
    if (!form.password) fieldErrors.password = "请输入密码。";
  }
  if (hasErrors()) return;
  busy.value = true;
  try {
    if (registering.value)
      await identity.register(form.username, form.display_name, form.password);
    else await identity.login(form.username, form.password);
    form.password = "";
    form.confirm = "";
    await router.replace(
      identity.session?.require_password_change ? "/account/security" : "/home",
    );
  } catch (err) {
    showError(err);
  } finally {
    busy.value = false;
  }
}
watch(
  () => route.path,
  () => {
    clearErrors();
    form.password = "";
    form.confirm = "";
  },
);
onUnmounted(() => {
  form.password = "";
  form.confirm = "";
});
</script>

<template>
  <div class="signin-page">
    <div class="signin-window" :class="{ registering }">
    <aside class="signin-brand-panel">
      <BrandLogo />
      <div class="signin-scene" aria-hidden="true"><svg viewBox="0 0 440 440" fill="none"><circle cx="220" cy="220" r="150" stroke="currentColor" opacity=".35"/><circle cx="220" cy="220" r="100" stroke="currentColor" opacity=".25"/><path d="M135 123C215 123 328 180 328 220S260 330 170 330" stroke="currentColor" stroke-dasharray="4 7" opacity=".65"/></svg><span class="node a"><UiIcon name="folder" /></span><span class="node b"><UiIcon name="code" /></span><span class="node c"><UiIcon name="bot" /></span></div>
    </aside>
    <main class="signin-main">
      <div class="signin-form">
        <h1>{{ registering ? "创建账号" : "欢迎回来" }}</h1>
        <template v-if="registering && !identity.settings.registration_enabled"
          ><div class="register-closed">
            <div class="confirm-icon"><UiIcon name="lock" /></div>
            <h3>本系统暂未开放注册</h3>
            <p>请联系系统管理员为你创建账号。</p>
          </div>
          <RouterLink class="btn auth-return" to="/login"
            >返回登录</RouterLink
          ></template
        >
        <template v-else>
          <ElForm
            ref="formRef"
            class="field-errors-form"
            label-position="top"
            :disabled="busy"
            @submit.prevent="submit"
          >
            <ElFormItem v-if="registering" label="显示名称" :error="fieldErrors.display_name" required
              ><ElInput
                v-model="form.display_name"
                @input="fieldErrors.display_name = ''"
                name="display-name"
                autocomplete="nickname"
                placeholder="你的姓名或常用称呼"
            /></ElFormItem>
            <ElFormItem label="用户名" :error="fieldErrors.username" required
              ><ElInput
                v-model="form.username"
                @input="fieldErrors.username = ''"
                name="username"
                :aria-describedby="registering ? 'register-username-help' : undefined"
                autocomplete="username"
                autocapitalize="none"
                :spellcheck="false"
                :placeholder="
                  registering ? '设置用于登录的用户名' : '请输入用户名'
                "
            />
              <p v-if="registering" id="register-username-help" class="form-field-help signin-username-help" :title="usernameHelp">3–30 位小写字母、数字、_ 或 -</p>
            </ElFormItem>
            <ElFormItem label="密码" :error="fieldErrors.password" required
              ><ElInput
                v-model="form.password"
                @input="fieldErrors.password = ''"
                name="password"
                :aria-describedby="registering ? 'register-password-help' : undefined"
                type="password"
                show-password
                :autocomplete="
                  registering ? 'new-password' : 'current-password'
                "
                :placeholder="registering ? '至少 8 个字符' : '请输入密码'"
            />
              <p v-if="registering" id="register-password-help" class="form-field-help">至少 8 个字符。</p>
            </ElFormItem>
            <ElFormItem v-if="registering" label="确认密码" :error="fieldErrors.confirm" required
              ><ElInput
                v-model="form.confirm"
                @input="fieldErrors.confirm = ''"
                name="confirm-password"
                type="password"
                show-password
                autocomplete="new-password"
                placeholder="再次输入密码"
            /></ElFormItem>
            <div v-if="!registering" class="signin-forgot">
              <button
                class="btn link"
                type="button"
                @click="
                  ElMessage.info(
                    '请联系管理员重置密码。创始人需由部署维护者协助恢复。',
                  )
                "
              >
                忘记密码？
              </button>
            </div>
            <div v-if="error" class="error-text" role="alert">{{ error }}</div>
            <ElButton
              class="signin-submit"
              type="primary"
              native-type="submit"
              :loading="busy"
              :disabled="busy"
              >{{ registering ? "创建账号" : "登录" }}<UiIcon name="arrow"
            /></ElButton>
          </ElForm>
          <div v-if="registering || identity.settings.registration_enabled" class="signin-bottom">
            {{ registering ? "已有账号？" : "还没有账号？"
            }}<RouterLink :to="registering ? '/login' : '/register'">{{
              registering ? "返回登录" : "创建账号"
            }}</RouterLink>
          </div>
        </template>
      </div>
    </main>
    </div>
  </div>
</template>

<style scoped>
.signin-page {
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 80px 24px 48px;
  background: var(--auth-canvas);
}
.signin-window {
  display: grid;
  grid-template-columns: 42% 58%;
  width: 100%;
  max-width: 1000px;
  min-height: 640px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 18px;
  background: var(--auth-surface);
  box-shadow: 0 24px 80px var(--shadow-color);
}
.signin-window.registering { min-height: 690px; }
.signin-brand-panel { position: relative; overflow: hidden; background: var(--auth-art); padding: 38px; }
.signin-brand-panel :deep(.brand) { position: relative; z-index: 1; gap: 10px; width: fit-content; }
.signin-brand-panel :deep(.brand-mark) { width: 34px; height: 34px; }
.signin-brand-panel :deep(.brand-wordmark) { font-size: 20px; font-weight: 600; letter-spacing: -.6px; }
.signin-scene { position: absolute; inset: 110px -20px 48px; display: grid; place-items: center; }
.signin-scene > svg { width: 100%; height: auto; color: var(--border-control); }
.node { position: absolute; display: grid; place-items: center; width: 72px; height: 72px; border: 1px solid var(--border); border-radius: 18px; background: var(--auth-tile); box-shadow: 0 10px 30px var(--shadow-color); transform: rotate(-7deg); }
.node svg { width: 29px; height: 29px; color: var(--text-muted); }
.node.a { left: 22%; top: 22%; }
.node.b { right: 17%; top: 38%; transform: rotate(8deg); }
.node.c { left: 30%; bottom: 18%; transform: rotate(-3deg); }
.node.c svg { width: 44px; height: 44px; }
.signin-main { display: flex; align-items: center; justify-content: center; min-width: 0; padding: 46px 56px; }
.signin-form { width: 100%; max-width: 352px; }
.signin-form h1 { margin: 0 0 30px; font-size: 28px; line-height: 1.4; font-weight: 600; letter-spacing: -.4px; }
.signin-form :deep(.el-form-item) { margin-bottom: 20px; }
.signin-form :deep(.el-input__wrapper) { background: var(--auth-surface); }
.signin-form :deep(.el-input__inner) { --autofill-surface: var(--auth-surface); }
.signin-form :deep(.el-form-item__label) { font-weight: 500; }
.signin-form .form-field-help { margin: 7px 0 0; font-size: 12px; line-height: 1.65; color: var(--text-muted); }
.signin-form .signin-username-help { white-space: nowrap; }
.signin-forgot { display: flex; justify-content: flex-end; margin: -5px 0 22px; }
.signin-forgot .btn { padding: 0; min-height: auto; font-size: 13px; }
.signin-submit { width: 100%; min-height: 44px; border-radius: 7px; }
.signin-bottom { margin-top: 24px; text-align: center; font-size: 13px; color: var(--text-muted); }
.signin-bottom a { margin-left: 8px; color: var(--text-primary); font-weight: 500; }
.signin-bottom a:hover, .signin-forgot .btn:hover { text-decoration: underline; }
.registering .signin-form h1 { margin-bottom: 24px; }
.registering :deep(.el-form-item) { margin-bottom: 15px; }
@media (max-width: 650px) {
  .signin-page { padding: 72px 16px 32px; align-items: start; }
  .signin-window, .signin-window.registering { grid-template-columns: 1fr; min-height: 0; max-width: 430px; }
  .signin-brand-panel { padding: 24px 28px; background: var(--auth-surface); }
  .signin-scene { display: none; }
  .signin-main { padding: 12px 28px 38px; }
  .signin-form { max-width: none; }
  .signin-form h1 { font-size: 25px; }
}
@media (max-width: 380px) { .signin-main { padding-inline: 18px; } }
</style>
