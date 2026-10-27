<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import {
  ElButton,
  ElDialog,
  ElDropdown,
  ElDropdownMenu,
  ElDropdownItem,
  ElForm,
  ElFormItem,
  ElInput,
  ElMessage,
  ElMessageBox,
} from "element-plus";
import AppLayout from "../../app/AppLayout.vue";
import UiIcon from "../../shared/UiIcon.vue";
import { api, ApiError, request } from "../../shared/api";
import {
  useIdentity,
  identityLabel,
  errorMessage,
  validatePassword,
  type User,
} from "../identity/store";
import { useRoute } from "vue-router";
import PageSizeSelect from "../../shared/PageSizeSelect.vue";
import { usePageSize } from "../../shared/pageSize";
import UserAvatar from "../../shared/UserAvatar.vue";
import AvatarEditor from "../media/AvatarEditor.vue";
const route = useRoute();
const counts = ref<{
  users_total: number;
  users_active: number;
  admins_total: number;
  users_disabled: number;
}>();
const avatarEditor = ref<InstanceType<typeof AvatarEditor>>();
const avatarChange = ref<string | null>();
const avatarProcessing = ref(false);
const identity = useIdentity();
const users = ref<User[]>([]);
const total = ref(0);
const loading = ref(false);
const busy = ref(false);
const error = ref("");
const dialogError = ref("");
const managedForm = ref<InstanceType<typeof ElForm>>();
const fieldErrors = reactive({ username: "", display_name: "", password: "", confirm: "", role: "" });
function clearErrors() {
  dialogError.value = "";
  Object.keys(fieldErrors).forEach(key => fieldErrors[key as keyof typeof fieldErrors] = "");
}
async function focusError() {
  await nextTick();
  const input = managedForm.value?.$el.querySelector(".is-error input") as HTMLInputElement | null;
  input?.focus({ preventScroll: true });
  input?.scrollIntoView({ block: "center", behavior: "instant" });
}
function showSaveError(err: unknown) {
  if (err instanceof ApiError && err.code === "USERNAME_TAKEN") {
    fieldErrors.username = errorMessage(err);
  } else if (err instanceof ApiError && err.code === "VALIDATION_FAILED") {
    const supported = new Set(["too_short", "too_many_bytes", "invalid_length", "invalid_format", "invalid_value", "null_not_allowed"]);
    let unmatched = err.details.length === 0;
    for (const detail of err.details) {
      const field = detail.field === "new_password" ? "password" : detail.field;
      if (field && Object.hasOwn(fieldErrors, field) && supported.has(detail.code)) {
        const key = field as keyof typeof fieldErrors;
        const message = errorMessage(new ApiError(err.code, err.message, [detail], err.requestId));
        fieldErrors[key] = [fieldErrors[key], message].filter(Boolean).join("；");
      } else unmatched = true;
    }
    if (unmatched) dialogError.value = errorMessage(err);
  } else dialogError.value = errorMessage(err);
  void focusError();
}
const pageSize = usePageSize("users");
const filters = reactive({
  q: "",
  status: String(route.query.status ?? ""),
  identity: ["founder", "admin", "user"].includes(String(route.query.identity))
    ? String(route.query.identity)
    : "",
  page: 1,
  page_size: pageSize.value,
});
watch(pageSize, value => {
  filters.page_size = value;
  search();
});
const dialog = ref(false);
const mode = ref<"create" | "edit" | "password">("create");
const target = ref<User>();
const etag = ref("");
const form = reactive({
  username: "",
  display_name: "",
  role: "user",
  password: "",
  confirm: "",
});
function canManage(user: User) {
  return !user.is_founder && user.id !== identity.user?.id;
}
function canEdit(user: User) {
  return !user.is_founder || user.id === identity.user?.id;
}
async function load() {
  loading.value = true;
  error.value = "";
  try {
    const query = new URLSearchParams(
      Object.entries(filters).map(([key, value]) => [key, String(value)]),
    );
    const [r, overview] = await Promise.all([
      request<User[]>(`/admin/users?${query}`),
      api<{
        users_total: number;
        users_active: number;
        admins_total: number;
        users_disabled: number;
      }>("/admin/overview"),
    ]);
    counts.value = overview;
    users.value = r.data;
    total.value = r.pagination?.total ?? 0;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}
function search() {
  filters.page = 1;
  void load();
}
function clearPassword() {
  form.password = "";
  form.confirm = "";
}
function createUser() {
  avatarEditor.value?.reset();
  avatarChange.value = undefined;
  mode.value = "create";
  target.value = undefined;
  Object.assign(form, {
    username: "",
    display_name: "",
    role: "user",
    password: "",
    confirm: "",
  });
  clearErrors();
  dialog.value = true;
}
async function edit(user: User, password = false) {
  try {
    const r = await request<User>(`/admin/users/${user.id}`);
    avatarEditor.value?.reset();
    avatarChange.value = undefined;
    target.value = r.data;
    etag.value = r.etag;
    mode.value = password ? "password" : "edit";
    Object.assign(form, {
      username: r.data.username,
      display_name: r.data.display_name,
      role: r.data.role,
      password: "",
      confirm: "",
    });
    clearErrors();
    dialog.value = true;
  } catch (err) {
    ElMessage.error(errorMessage(err));
  }
}
async function save() {
  if (busy.value || avatarProcessing.value) return;
  clearErrors();
  if (mode.value !== "edit") {
    fieldErrors.password = validatePassword(form.password);
    if (form.password !== form.confirm)
      fieldErrors.confirm = "两次输入的密码不一致。";
    if (fieldErrors.password || fieldErrors.confirm) {
      void focusError();
      return;
    }
  }
  busy.value = true;
  try {
    if (mode.value === "create")
      await request("/admin/users", {
        method: "POST",
        body: {
          username: form.username,
          display_name: form.display_name,
          role: form.role,
          password: form.password,
          ...(avatarChange.value !== undefined
            ? { avatar_upload_id: avatarChange.value }
            : {}),
        },
      });
    else if (mode.value === "password")
      await request(`/admin/users/${target.value!.id}/password`, {
        method: "PUT",
        etag: etag.value,
        body: { new_password: form.password },
      });
    else
      await request(`/admin/users/${target.value!.id}`, {
        method: "PATCH",
        etag: etag.value,
        body: {
          username: form.username,
          display_name: form.display_name,
          ...(avatarChange.value !== undefined
            ? { avatar_upload_id: avatarChange.value }
            : {}),
        },
      });
    avatarEditor.value?.saved();
    clearPassword();
    dialog.value = false;
    ElMessage.success(
      mode.value === "password"
        ? "密码已重置，用户下次登录需要改密。"
        : "用户信息已保存。",
    );
    await identity.refresh();
    await load();
  } catch (err) {
    showSaveError(err);
  } finally {
    busy.value = false;
  }
}
async function command(value: string | number | object, user: User) {
  if (value === "password") {
    await edit(user, true);
    return;
  }
  try {
    const current = await request<User>(`/admin/users/${user.id}`);
    const u = current.data;
    if (value === "delete") {
      const result = await ElMessageBox.prompt(
        `删除后无法恢复，用户名不会释放。请输入 ${u.username} 确认删除。`,
        "删除用户",
        {
          confirmButtonText: "确认删除",
          cancelButtonText: "取消",
          inputValidator: (v) => v === u.username || "请输入完全一致的用户名。",
        },
      );
      await request(`/admin/users/${u.id}`, {
        method: "DELETE",
        etag: current.etag,
        headers: { "X-Confirm-Username": result.value },
      });
    } else {
      const role = value === "role";
      const next = role
        ? u.role === "admin"
          ? "user"
          : "admin"
        : u.status === "active"
          ? "disabled"
          : "active";
      const label = role
        ? next === "admin"
          ? "设为管理员"
          : "取消管理员身份"
        : next === "disabled"
          ? "禁用"
          : "启用";
      await ElMessageBox.confirm(
        `确定${label}“${u.display_name}”吗？此用户现有的登录会话将失效。`,
        "确认操作",
        { confirmButtonText: "确定", cancelButtonText: "取消" },
      );
      await request(`/admin/users/${u.id}/${role ? "role" : "status"}`, {
        method: "PUT",
        etag: current.etag,
        body: role ? { role: next } : { status: next },
      });
    }
    ElMessage.success("操作已完成。");
    await load();
  } catch (err) {
    if (err !== "cancel" && err !== "close") ElMessage.error(errorMessage(err));
  }
}
onMounted(() => {
  void load();
  if (route.query.create === "1") createUser();
});
onUnmounted(clearPassword);
</script>
<template>
  <AppLayout>
    <div v-if="error" class="error-banner" role="alert">{{ error }}</div>
    <section class="panel" aria-label="用户列表" :aria-busy="loading">
      <div class="tabs">
        <button
          v-for="status in [
            { value: '', label: '全部用户', count: counts?.users_total },
            { value: 'active', label: '正常账号', count: counts?.users_active },
            {
              value: 'disabled',
              label: '已禁用',
              count: counts?.users_disabled,
            },
          ]"
          :key="status.value"
          class="tab"
          :class="{ active: filters.status === status.value }"
          @click="
            filters.status = status.value;
            search();
          "
        >
          {{ status.label
          }}<span class="tab-count">{{ status.count ?? "…" }}</span>
        </button>
      </div>
      <div class="table-toolbar users-toolbar">
        <label class="search-box"
          ><UiIcon name="search" /><input
            v-model="filters.q"
            name="user-search"
            autocomplete="off"
            aria-label="搜索用户名或显示名称"
            placeholder="搜索用户名或显示名称…"
            @keyup.enter="search" /></label
        ><select
          v-model="filters.identity"
          class="select-filter"
          aria-label="筛选用户身份"
          @change="search"
        >
          <option value="">全部身份</option>
          <option value="founder">创始人</option>
          <option value="admin">管理员</option>
          <option value="user">普通用户</option></select
        ><ElButton :loading="loading" @click="search">查询</ElButton>
        <ElButton class="users-create" type="primary" @click="createUser"><UiIcon name="plus" />添加用户</ElButton>
      </div>
      <div v-if="users.length" class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>用户</th>
              <th>身份</th>
              <th>状态</th>
              <th>创建时间</th>
              <th>最近登录</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="user in users" :key="user.id">
              <td>
                <div class="user-cell">
                  <UserAvatar :user="user" />
                  <div>
                    <div class="user-primary">
                      {{ user.display_name
                      }}<span
                        v-if="user.id === identity.user?.id"
                        class="you-badge"
                        >你</span
                      >
                    </div>
                    <div class="user-secondary">@{{ user.username }}</div>
                  </div>
                </div>
              </td>
              <td>
                <span
                  class="badge"
                  :class="user.is_founder ? 'founder' : user.role"
                  ><UiIcon v-if="user.role === 'admin'" name="shield" />{{
                    identityLabel(user)
                  }}</span
                >
              </td>
              <td>
                <span class="status" :class="user.status">{{
                  user.status === "active" ? "正常" : "已禁用"
                }}</span>
              </td>
              <td class="mono">{{ identity.date(user.created_at) }}</td>
              <td class="mono">{{ identity.date(user.last_login_at) }}</td>
              <td>
                <div class="row-actions">
                  <button
                    class="btn link"
                    :disabled="!canEdit(user)"
                    @click="edit(user)"
                  >
                    编辑</button
                  ><ElDropdown
                    v-if="canManage(user)"
                    trigger="click"
                    popper-class="action-dropdown"
                    @command="command($event, user)"
                    ><button
                      class="icon-btn row-more"
                      :aria-label="`${user.display_name}的更多操作`"
                    >
                      <UiIcon name="more" /></button
                    ><template #dropdown
                      ><ElDropdownMenu
                        ><ElDropdownItem command="role">{{
                          user.role === "admin"
                            ? "取消管理员身份"
                            : "设为管理员"
                        }}</ElDropdownItem
                        ><ElDropdownItem command="status">{{
                          user.status === "active" ? "禁用用户" : "启用用户"
                        }}</ElDropdownItem
                        ><ElDropdownItem command="password"
                          >重置密码</ElDropdownItem
                        ><ElDropdownItem class="danger" command="delete" divided
                          >删除用户</ElDropdownItem
                        ></ElDropdownMenu
                      ></template
                    ></ElDropdown
                  >
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="empty">
        <UiIcon name="search" />
        <h3>{{ loading ? "正在加载用户" : "没有找到匹配的用户" }}</h3>
        <p v-if="!loading">试试其他关键词，或清除当前筛选条件。</p>
      </div>
      <div class="table-footer">
        <div class="list-page-summary">
          <span>共 {{ total }} 位用户</span>
          <PageSizeSelect v-model="pageSize" :disabled="loading" />
        </div>
        <div class="pagination">
          <button
            class="page-button"
            :disabled="filters.page === 1 || loading"
            aria-label="上一页"
            @click="
              filters.page--;
              load();
            "
          >
            <UiIcon name="back" /></button
          ><span
            >{{ filters.page }} /
            {{ Math.max(1, Math.ceil(total / filters.page_size)) }}</span
          ><button
            class="page-button"
            :disabled="filters.page * filters.page_size >= total || loading"
            aria-label="下一页"
            @click="
              filters.page++;
              load();
            "
          >
            <UiIcon name="chevron" />
          </button>
        </div>
      </div>
    </section>
    <ElDialog
      v-model="dialog"
      class="app-dialog user-dialog"
      align-center
      :title="
        mode === 'create'
          ? '创建用户'
          : mode === 'password'
            ? '重置密码'
            : '编辑用户'
      "
      width="640px"
      :close-on-click-modal="!busy && !avatarProcessing"
      :close-on-press-escape="!busy && !avatarProcessing"
      :show-close="!busy && !avatarProcessing"
      @closed="
        clearPassword();
        avatarEditor?.reset();
        avatarChange = undefined;
      "
    >
      <div v-if="dialogError" class="error-banner" role="alert">
        {{ dialogError }}
      </div>
      <ElForm ref="managedForm" id="managed-user-form" label-position="top" :disabled="busy" @submit.prevent="save">
        <template v-if="mode !== 'password'">
          <AvatarEditor
            ref="avatarEditor"
            v-model="avatarChange"
            :avatar="target?.avatar"
            :disabled="busy"
            @processing="avatarProcessing = $event"
          />
          <div class="form-row spaced">
            <ElFormItem label="显示名称" :error="fieldErrors.display_name" required
              ><ElInput
                v-model="form.display_name"
                @input="fieldErrors.display_name = ''"
                name="managed-display-name"
                autocomplete="off"
                maxlength="30"
                placeholder="姓名或常用称呼" /></ElFormItem
            ><ElFormItem label="用户名" :error="fieldErrors.username" required
              ><ElInput
                v-model="form.username"
                @input="fieldErrors.username = ''"
                name="managed-username"
                autocomplete="off"
                autocapitalize="none"
                :spellcheck="false"
                placeholder="设置用于登录的用户名"
                aria-describedby="managed-username-help"
            />
              <p id="managed-username-help" class="managed-field-help">
                使用 3–30 位小写字母、数字、下划线或短横线，以字母或数字开头。
              </p>
            </ElFormItem>
          </div>
          <ElFormItem v-if="mode === 'create'" label="系统身份" :error="fieldErrors.role" required
            ><div class="role-choices">
              <label class="role-choice"
                ><input
                  v-model="form.role"
                  type="radio"
                  value="user"
                  :disabled="busy"
                /><span
                  ><strong>普通用户</strong
                  ><small>管理个人账号，无法进入控制台。</small></span
                ></label
              ><label class="role-choice"
                ><input
                  v-model="form.role"
                  type="radio"
                  value="admin"
                  :disabled="busy"
                /><span
                  ><strong>管理员</strong
                  ><small>拥有完整系统管理权限。</small></span
                ></label
              >
            </div></ElFormItem
          >
        </template>
        <template v-if="mode !== 'edit'">
          <div class="form-row spaced">
            <ElFormItem label="密码" :error="fieldErrors.password" required
              ><ElInput
                v-model="form.password"
                @input="fieldErrors.password = ''"
                name="managed-new-password"
                aria-describedby="managed-password-help"
                type="password"
                show-password
                autocomplete="new-password"
            />
              <p id="managed-password-help" class="managed-field-help">至少 8 个字符，最多 72 个 UTF-8 字节。</p>
            </ElFormItem>
            <ElFormItem label="确认密码" :error="fieldErrors.confirm" required
              ><ElInput
                v-model="form.confirm"
                @input="fieldErrors.confirm = ''"
                name="managed-confirm-password"
                type="password"
                show-password
                autocomplete="new-password"
            /></ElFormItem>
          </div>
          <div class="info-note">
            用户下次登录必须修改密码。请通过合适的方式告知用户初始密码。
          </div></template
        >
      </ElForm>
      <template #footer>
        <div class="user-dialog-actions">
          <ElButton :disabled="busy || avatarProcessing" @click="dialog = false"
            >取消</ElButton
          ><ElButton
            type="primary"
            native-type="submit"
            form="managed-user-form"
            :loading="busy"
            :disabled="busy || avatarProcessing"
            >{{ mode === "create" ? "创建用户" : "保存" }}</ElButton
          >
        </div>
      </template>
    </ElDialog>
  </AppLayout>
</template>

<style>
.user-dialog .el-form-item__error {
  position: static;
  width: 100%;
  font-size: 13px;
  line-height: 1.6;
  padding-top: 6px;
}
.user-dialog .managed-field-help {
  width: 100%;
  margin: 6px 0 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-muted);
}

.user-dialog .el-dialog__header,
.user-dialog .el-dialog__footer {
  flex-shrink: 0;
}
.user-dialog .el-dialog__body {
  min-height: 0;
  padding: 20px 24px;
}
.user-dialog .el-dialog__footer {
  padding: 16px 24px;
  border-top: 1px solid var(--border);
  background: var(--surface-subtle);
}
.user-dialog .user-dialog-actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 10px;
}
.user-dialog .user-dialog-actions .el-button + .el-button {
  margin-left: 0;
}
.user-dialog .avatar-editor {
  gap: 16px;
  margin-bottom: 16px;
  padding-bottom: 16px;
}
.user-dialog .form-row {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.user-dialog .role-choices {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
@media (max-width: 600px) {
  .user-dialog .form-row,
  .user-dialog .role-choices {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
