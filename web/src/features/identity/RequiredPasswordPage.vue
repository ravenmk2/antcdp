<script setup lang="ts">
import { onUnmounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { ElButton, ElForm, ElFormItem, ElInput, ElMessage } from "element-plus";
import AppearanceSelect from "../../shared/AppearanceSelect.vue";
import { request, resetCSRF } from "../../shared/api";
import { useIdentity, validatePassword } from "./store";
import { useFormErrors, passwordHelp } from "../../shared/formErrors";
import { useLogout } from "./logout";

const identity = useIdentity();
const router = useRouter();
const { logout, loggingOut } = useLogout();
const form = reactive({ current: "", next: "", confirm: "" });
const busy = ref(false);
const { formRef, error, fieldErrors, clearErrors, showError, hasErrors } = useFormErrors(["current", "next", "confirm"] as const, { current_password: "current", new_password: "next" });
async function save() {
  if (busy.value || loggingOut.value) return;
  clearErrors();
  if (!form.current) fieldErrors.current = "请输入当前密码。";
  fieldErrors.next = validatePassword(form.next);
  if (form.next !== form.confirm) fieldErrors.confirm = "两次输入的密码不一致。";
  if (hasErrors()) return;
  busy.value = true;
  try {
    await request("/account/password", { method: "PUT", body: { current_password: form.current, new_password: form.next } });
    identity.session = null;
    resetCSRF();
    ElMessage.success("密码已更新，请重新登录。");
    await router.replace("/login");
  } catch (err) { showError(err); }
  finally { busy.value = false; }
}
onUnmounted(() => { form.current = ""; form.next = ""; form.confirm = ""; });
</script>

<template>
  <main class="required-password-page">
    <div class="public-appearance"><AppearanceSelect /></div>
    <section class="panel required-password-card" aria-labelledby="required-password-title">
      <div class="brand" aria-label="AntCDP"><span class="brand-mark" aria-hidden="true" /><span class="brand-wordmark">AntCDP</span></div>
      <h1 id="required-password-title">设置新密码</h1>
      <p>此账号使用管理员设置的密码，请修改后继续使用。忘记当前密码时，可退出并联系管理员。</p>
      <div v-if="error" class="error-banner" role="alert">{{ error }}</div>
      <ElForm ref="formRef" class="field-errors-form" label-position="top" :disabled="busy || loggingOut" @submit.prevent="save">
        <ElFormItem label="当前密码" :error="fieldErrors.current" required><ElInput v-model="form.current" @input="fieldErrors.current = ''" name="current-password" type="password" show-password autocomplete="current-password" /></ElFormItem>
        <ElFormItem label="新密码" :error="fieldErrors.next" required><ElInput v-model="form.next" @input="fieldErrors.next = ''" name="new-password" type="password" show-password autocomplete="new-password" aria-describedby="new-password-help" /><p id="new-password-help" class="form-field-help">{{ passwordHelp }}</p></ElFormItem>
        <ElFormItem label="确认新密码" :error="fieldErrors.confirm" required><ElInput v-model="form.confirm" @input="fieldErrors.confirm = ''" name="confirm-password" type="password" show-password autocomplete="new-password" /></ElFormItem>
        <p class="field-help">修改后所有登录会话都会失效，需要重新登录。</p>
        <div class="required-password-actions">
          <ElButton :loading="loggingOut" :disabled="busy || loggingOut" @click="logout">退出登录</ElButton>
          <ElButton type="primary" native-type="submit" :loading="busy" :disabled="busy || loggingOut">更新密码</ElButton>
        </div>
      </ElForm>
    </section>
  </main>
</template>

<style scoped>
.required-password-page { min-height: 100dvh; padding: 88px 17px 32px; display: grid; place-items: center; }
.required-password-card { width: min(100%, 480px); padding: 24px; }
h1 { margin: 24px 0 12px; font-size: 26px; }
p { color: var(--text-secondary); margin-bottom: 20px; }
.required-password-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px; margin-top: 24px; }
.required-password-actions .el-button + .el-button { margin-left: 0; }
</style>
