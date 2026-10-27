<script setup lang="ts">
import { computed, ref, reactive, watch, onUnmounted } from "vue";
import {
  useRoute,
  useRouter,
  onBeforeRouteLeave,
  onBeforeRouteUpdate,
} from "vue-router";
import {
  ElButton,
  ElDialog,
  ElInput,
  ElSelect,
  ElOption,
  ElForm,
  ElFormItem,
  ElMessage,
  ElMessageBox,
  ElPagination,
  ElCheckbox,
} from "element-plus";
import AppLayout from "../../app/AppLayout.vue";
import { api, request, ApiError } from "../../shared/api";
import { useIdentity, errorMessage } from "../identity/store";
import { useShortcuts } from "./sidebar";
import ResourceIcon from "./ResourceIcon.vue";
import AvatarEditor from "../media/AvatarEditor.vue";
import {
  iconKeys,
  iconLabels,
  statusLabel,
  type Kind,
  type Resource,
  type Member,
  type Page,
  type Option,
} from "./model";
import { renderDescription } from "./markdown";
const route = useRoute(),
  router = useRouter(),
  identity = useIdentity(),
  shortcuts = useShortcuts();
const kind = computed<Kind>(() =>
  route.path.includes("/teams") ? "teams" : "projects",
);
const label = computed(() => (kind.value === "teams" ? "团队" : "项目"));
const consoleMode = computed(() => route.path.startsWith("/admin"));
const base = computed(
  () => `${consoleMode.value ? "/admin" : ""}/${kind.value}`,
);
const id = computed(() => String(route.params.id || ""));
const rows = ref<Resource[]>([]),
  total = ref(0),
  page = ref(1),
  query = ref(""),
  status = ref("active"),
  unmanaged = ref(false);
const detail = ref<Resource>(),
  members = ref<Member[]>([]),
  teams = ref<Resource[]>([]);
const memberPage = ref(1),
  memberTotal = ref(0),
  memberSearch = ref("");
let memberSearchTimer: ReturnType<typeof setTimeout> | undefined;
watch(memberPage, load);
watch(memberSearch, () => {
  clearTimeout(memberSearchTimer);
  memberSearchTimer = setTimeout(() => {
    memberPage.value = 1;
    void load();
  }, 600);
});
const loading = ref(false),
  busy = ref(false),
  error = ref(""),
  tab = ref("overview");
const editor = ref(false),
  creating = ref(false),
  formError = ref(""),
  fieldErrors = ref<Record<string, string>>({});
const options = ref<Option[]>([]),
  grantOptions = ref<Option[]>([]),
  grantOpen = ref(false),
  grantType = ref<"user" | "team">("user");
const grantID = ref(""),
  grantRole = ref("member");
const form = reactive({
  code: "",
  name: "",
  summary: "",
  description: "",
  icon: "",
  file: "",
  admins: [] as string[],
});
const iconEditor = ref<InstanceType<typeof AvatarEditor>>(),
  iconChange = ref<string | null>(),
  iconProcessing = ref(false);
watch(iconChange, (value) => {
  if (value !== undefined) {
    form.file = value || "";
    form.icon = value ? "upload" : "";
  }
});
function chooseIcon(key: string) {
  iconEditor.value?.reset();
  form.icon = key;
  form.file = "";
}
let formSnapshot = "",
  editTag = "",
  memberTag = "",
  loadSequence = 0,
  optionSequence = 0;
let searchTimer: ReturnType<typeof setTimeout> | undefined;
const dirty = computed(
  () => editor.value && JSON.stringify(form) !== formSnapshot,
);
const html = computed(() => renderDescription(detail.value?.description || ""));
const preview = ref(false);
async function mayLeave() {
  if (editor.value && (busy.value || iconProcessing.value)) return false;
  if (!dirty.value) return true;
  try {
    await ElMessageBox.confirm("尚有未保存的修改，确定放弃？", "放弃修改", {
      confirmButtonText: "放弃",
      cancelButtonText: "继续编辑",
      type: "warning",
    });
    editor.value = false;
    return true;
  } catch {
    return false;
  }
}
onBeforeRouteLeave(mayLeave);
onBeforeRouteUpdate(mayLeave);
function beforeUnload(event: BeforeUnloadEvent) {
  if (dirty.value) {
    event.preventDefault();
    event.returnValue = "";
  }
}
window.addEventListener("beforeunload", beforeUnload);
onUnmounted(() => {
  clearTimeout(searchTimer);
  clearTimeout(memberSearchTimer);
  loadSequence++;
  optionSequence++;
  window.removeEventListener("beforeunload", beforeUnload);
});
async function load() {
  const seq = ++loadSequence,
    endpoint = `/${kind.value}`,
    current = id.value;
  loading.value = true;
  error.value = "";
  try {
    if (current) {
      const value = await api<Resource>(`${endpoint}/${current}`);
      const results = await Promise.all([
        api<{ items: Member[]; total: number; membership_etag: string }>(
          `${endpoint}/${current}/members?page=${memberPage.value}&page_size=20&q=${encodeURIComponent(memberSearch.value)}`,
        ),
        api<Resource[]>(
          `${endpoint}/${current}/${kind.value === "projects" ? "teams" : "projects"}`,
        ),
      ]);
      if (seq !== loadSequence) return;
      detail.value = value;
      members.value = results[0].items;
      memberTotal.value = results[0].total;
      detail.value.membership_etag = results[0].membership_etag;
      teams.value = results[1];
    } else {
      const result = await api<Page>(
        `${endpoint}?scope=${consoleMode.value ? "all" : "mine"}&status=${status.value}&page=${page.value}&page_size=20&q=${encodeURIComponent(query.value)}&unmanaged=${unmanaged.value}`,
      );
      if (seq !== loadSequence) return;
      rows.value = result.items;
      total.value = result.total;
    }
  } catch (e) {
    if (seq === loadSequence) error.value = errorMessage(e);
  } finally {
    if (seq === loadSequence) loading.value = false;
  }
}
watch(
  () => route.path,
  () => {
    page.value = 1;
    memberPage.value = 1;
    memberSearch.value = "";
    detail.value = undefined;
    editor.value = false;
    grantOpen.value = false;
    tab.value = "overview";
    void load();
  },
  { immediate: true },
);
watch(query, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    page.value = 1;
    void load();
  }, 600);
});
watch([status, unmanaged], () => {
  page.value = 1;
  void load();
});
watch(page, load);
async function searchUsers(q: string) {
  const seq = ++optionSequence;
  try {
    const result = await api<Option[]>(
      `${creating.value ? "/admin/collaboration/user-options" : `/${kind.value}/${id.value}/member-options`}?q=${encodeURIComponent(q)}`,
    );
    if (seq === optionSequence) options.value = result;
  } catch (e) {
    formError.value = errorMessage(e);
  }
}
async function edit(create = false) {
  creating.value = create;
  formError.value = "";
  fieldErrors.value = {};
  preview.value = false;
  const d = detail.value;
  iconEditor.value?.reset();
  iconChange.value = undefined;
  Object.assign(form, {
    code: create ? "" : d?.code || "",
    name: create ? "" : d?.name || "",
    summary: create ? "" : d?.summary || "",
    description: create ? "" : d?.description || "",
    icon: create ? "" : d?.icon_file_id ? "upload" : d?.icon_key || "",
    file: create ? "" : d?.icon_file_id || "",
    admins: create && identity.user ? [identity.user.id] : [],
  });
  editTag = d?.etag || "";
  formSnapshot = JSON.stringify(form);
  editor.value = true;
  if (create) await searchUsers("");
}
async function closeEditor(done?: () => void) {
  if (await mayLeave()) {
    editor.value = false;
    iconEditor.value?.reset();
    done?.();
  }
}
async function save() {
  if (iconProcessing.value || busy.value) return;
  fieldErrors.value = {};
  formError.value = "";
  if (!form.name.trim() || [...form.name.trim()].length > 100)
    fieldErrors.value.name = "名称为 1–100 个字符";
  if (
    creating.value &&
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,62}[A-Za-z0-9]$/.test(form.code)
  )
    fieldErrors.value.code =
      "2–64 位字母、数字、下划线或连字符，首尾为字母或数字";
  if (creating.value && !form.admins.length)
    fieldErrors.value.admin_user_ids = "请至少选择一位初始管理员";
  if ([...form.summary].length > 300)
    fieldErrors.value.summary = "摘要最多 300 个字符";
  if (new TextEncoder().encode(form.description).length > 102400)
    fieldErrors.value.description = "简介不能超过 100 KiB";
  if (Object.keys(fieldErrors.value).length) return;
  busy.value = true;
  try {
    const body = {
      name: form.name,
      summary: form.summary,
      description: form.description,
      icon:
        form.icon === "upload"
          ? { type: "upload", file_id: form.file }
          : form.icon
            ? { type: "builtin", key: form.icon }
            : { type: "default" },
      ...(creating.value
        ? { code: form.code, admin_user_ids: form.admins }
        : {}),
    };
    const result = await request<Resource>(
      `/${kind.value}${creating.value ? "" : `/${id.value}`}`,
      {
        method: creating.value ? "POST" : "PATCH",
        body,
        etag: creating.value ? undefined : editTag,
      },
    );
    iconEditor.value?.saved();
    editor.value = false;
    ElMessage.success("已保存");
    if (creating.value) await router.push(`${base.value}/${result.data.id}`);
    else await load();
    await shortcuts.refresh();
  } catch (e) {
    formError.value = errorMessage(e);
    if (e instanceof ApiError) {
      if (e.code === "CODE_CONFLICT") fieldErrors.value.code = e.message;
      if (e.code === "NAME_CONFLICT") fieldErrors.value.name = e.message;
    }
  } finally {
    busy.value = false;
  }
}
async function action(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
  tagValue?: string,
  leave = false,
) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    await request(path, { method, body, etag: tagValue });
    grantOpen.value = false;
    await shortcuts.refresh();
    if (leave) await router.push(base.value);
    else await load();
    ElMessage.success("操作已完成");
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
async function lifecycle(op: string) {
  try {
    await ElMessageBox.confirm(
      op === "dissolve"
        ? "解散将移除所有成员和项目授权，且不能恢复。"
        : op === "archive"
          ? "归档后项目仅可查看，系统管理员可恢复。"
          : op === "leave"
            ? "退出会移除你的直接成员身份。其他团队带来的项目权限仍会保留。"
            : "确定恢复该项目？",
      `${op === "dissolve" ? "解散" : op === "archive" ? "归档" : op === "leave" ? "退出" : "恢复"}${label.value}`,
      { confirmButtonText: "确认", cancelButtonText: "取消", type: "warning" },
    );
  } catch {
    return;
  }
  const d = detail.value!;
  await action(
    `/${kind.value}/${id.value}/${op}`,
    "POST",
    undefined,
    op === "leave" ? undefined : op === "dissolve" ? d.dissolve_etag : d.etag,
    op === "leave",
  );
}
async function openGrant(type: "user" | "team") {
  grantType.value = type;
  grantID.value = "";
  grantRole.value = "member";
  memberTag = detail.value!.membership_etag;
  grantOpen.value = true;
  await searchGrants("");
}
async function searchGrants(q: string) {
  const seq = ++optionSequence;
  try {
    const result = await api<Option[]>(
      `/${kind.value}/${id.value}/${grantType.value === "user" ? "member-options" : "team-options"}?q=${encodeURIComponent(q)}`,
    );
    if (seq === optionSequence) grantOptions.value = result;
  } catch (e) {
    error.value = errorMessage(e);
  }
}
async function addGrant() {
  await action(
    `/${kind.value}/${id.value}/${grantType.value === "user" ? "members" : "teams"}`,
    "POST",
    grantType.value === "user"
      ? { user_id: grantID.value, role: grantRole.value }
      : { team_id: grantID.value },
    memberTag,
  );
}
async function removeMember(m: Member) {
  try {
    await ElMessageBox.confirm(
      `移除 ${m.display_name} 的直接成员身份？`,
      "移除成员",
      { confirmButtonText: "移除", cancelButtonText: "取消" },
    );
  } catch {
    return;
  }
  await action(
    `/${kind.value}/${id.value}/members/${m.user_id}`,
    "DELETE",
    undefined,
    detail.value!.membership_etag,
  );
}
async function removeTeam(t: Resource) {
  try {
    await ElMessageBox.confirm(
      `移除团队 ${t.name} 对本项目的授权？`,
      "移除团队",
      { confirmButtonText: "移除", cancelButtonText: "取消" },
    );
  } catch {
    return;
  }
  await action(
    `/projects/${id.value}/teams/${t.id}`,
    "DELETE",
    undefined,
    detail.value!.membership_etag,
  );
}
</script>
<template>
  <AppLayout
    ><div class="collaboration-page">
      <header class="collab-toolbar">
        <div>
          <RouterLink v-if="id" :to="base" class="back-link"
            >← {{ consoleMode ? "全部" : "我的" }}{{ label }}</RouterLink
          >
          <h1>
            {{
              id
                ? detail?.name || label
                : `${consoleMode ? "全部" : "我的"}${label}`
            }}
          </h1>
        </div>
        <div class="collab-actions">
          <ElButton :loading="loading" :disabled="busy" @click="load"
            >刷新</ElButton
          ><ElButton
            v-if="!id && consoleMode"
            type="primary"
            @click="edit(true)"
            >创建{{ label }}</ElButton
          ><ElButton v-if="detail?.can_manage" :disabled="busy" @click="edit()"
            >编辑资料</ElButton
          >
        </div>
      </header>
      <div v-if="error" class="collab-error" role="alert">
        {{ error }} <ElButton :disabled="busy" @click="load">重新加载</ElButton>
      </div>
      <template v-if="!id">
        <div class="collab-filters">
          <ElInput
            v-model="query"
            :placeholder="`搜索${label}名称、编码或摘要`"
            clearable
            aria-label="搜索"
          /><ElSelect v-model="status" aria-label="状态"
            ><ElOption label="正常" value="active" /><ElOption
              :label="kind === 'projects' ? '已归档' : '已解散'"
              :value="
                kind === 'projects' ? 'archived' : 'dissolved'
              " /><ElOption label="全部状态" value="all" /></ElSelect
          ><ElCheckbox v-if="consoleMode" v-model="unmanaged"
            >无有效管理员</ElCheckbox
          >
        </div>
        <div class="resource-grid" :aria-busy="loading">
          <RouterLink
            v-for="item in rows"
            :key="item.id"
            class="resource-card panel"
            :to="`${base}/${item.id}`"
            ><div class="resource-card-heading">
              <ResourceIcon
                :icon-key="item.icon_key"
                :file-id="item.icon_file_id"
              /><strong>{{ item.name }}</strong
              ><small>{{ statusLabel(item.status) }}</small>
            </div>
            <code>{{ item.code }}</code>
            <p>{{ item.summary || "暂无摘要" }}</p>
            <footer>
              {{ item.member_count }} 位成员<span>{{
                item.direct_role === "admin"
                  ? "管理员"
                  : item.is_member
                    ? "成员"
                    : ""
              }}</span>
            </footer></RouterLink
          >
        </div>
        <div v-if="!loading && !error && !rows.length" class="collab-empty">
          暂无{{ label
          }}{{
            consoleMode ? "，可创建后添加成员。" : "，加入后会显示在这里。"
          }}
        </div>
        <ElPagination
          v-if="total > 20"
          v-model:current-page="page"
          :total="total"
          :page-size="20"
          layout="prev, pager, next, total"
        />
      </template>
      <template v-else-if="detail">
        <section class="panel resource-summary">
          <ResourceIcon
            :icon-key="detail.icon_key"
            :file-id="detail.icon_file_id"
          />
          <div>
            <code>{{ detail.code }}</code>
            <p>{{ detail.summary || "暂无摘要" }}</p>
          </div>
          <span>{{ statusLabel(detail.status) }}</span>
        </section>
        <nav class="collab-tabs" aria-label="详情导航">
          <ElButton
            :type="tab === 'overview' ? 'primary' : 'default'"
            @click="tab = 'overview'"
            >简介</ElButton
          ><ElButton
            :type="tab === 'members' ? 'primary' : 'default'"
            @click="tab = 'members'"
            >成员 · {{ detail.member_count }}</ElButton
          ><ElButton
            :type="tab === 'teams' ? 'primary' : 'default'"
            @click="tab = 'teams'"
            >{{ kind === "projects" ? "参与团队" : "关联项目" }} ·
            {{ teams.length }}</ElButton
          >
        </nav>
        <section v-if="tab === 'overview'" class="panel description">
          <div
            v-if="detail.description"
            class="markdown-content"
            v-html="html"
          />
          <p v-else class="collab-empty">暂无简介</p>
        </section>
        <section v-if="tab === 'members'" class="panel members-panel">
          <ElInput
            v-model="memberSearch"
            placeholder="搜索成员名称或账号"
            clearable
            aria-label="搜索成员"
          />
          <header class="collab-toolbar">
            <h2>成员</h2>
            <ElButton
              v-if="detail.can_manage"
              :disabled="busy"
              @click="openGrant('user')"
              >添加成员</ElButton
            >
          </header>
          <p v-if="kind === 'projects'" class="muted">
            团队授予普通成员权限；管理员角色由项目直接授予。移除直接身份不会移除团队带来的权限。
          </p>
          <div class="collab-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>成员</th>
                  <th>权限来源</th>
                  <th>角色</th>
                  <th v-if="detail.can_manage">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="m in members" :key="m.user_id">
                  <td>
                    {{ m.display_name
                    }}<small
                      >@{{ m.username }} ·
                      {{
                        m.account_status === "active" ? "正常" : "已停用"
                      }}</small
                    >
                  </td>
                  <td>
                    <span
                      v-for="(source, i) in m.sources"
                      :key="i"
                      class="source-tag"
                      >{{
                        source.type === "direct" ? "直接加入" : source.team_name
                      }}</span
                    >
                  </td>
                  <td>
                    {{ m.effective_role === "admin" ? "管理员" : "成员" }}
                  </td>
                  <td v-if="detail.can_manage">
                    <template v-if="m.direct_role"
                      ><ElButton
                        size="small"
                        :disabled="busy"
                        @click="
                          action(
                            `/${kind}/${id}/members/${m.user_id}`,
                            'PATCH',
                            {
                              role:
                                m.direct_role === 'admin' ? 'member' : 'admin',
                            },
                            detail.membership_etag,
                          )
                        "
                        >{{
                          m.direct_role === "admin" ? "设为成员" : "设为管理员"
                        }}</ElButton
                      ><ElButton
                        size="small"
                        :disabled="busy"
                        @click="removeMember(m)"
                        >移除</ElButton
                      ></template
                    ><span v-else>由团队管理</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="!members.length" class="collab-empty">
            {{
              memberSearch
                ? "没有匹配的成员。"
                : "暂无成员。系统管理员可重新添加成员。"
            }}
          </p>
          <ElPagination
            v-if="memberTotal > 20"
            v-model:current-page="memberPage"
            :total="memberTotal"
            :page-size="20"
            layout="prev, pager, next, total"
          />
        </section>
        <section v-if="tab === 'teams'" class="panel members-panel">
          <header class="collab-toolbar">
            <h2>{{ kind === "projects" ? "参与团队" : "关联项目" }}</h2>
            <ElButton
              v-if="kind === 'projects' && detail.can_manage"
              :disabled="busy"
              @click="openGrant('team')"
              >添加团队</ElButton
            >
          </header>
          <div v-for="t in teams" :key="t.id" class="team-row">
            <ResourceIcon :icon-key="t.icon_key" :file-id="t.icon_file_id" />
            <div>
              <RouterLink
                v-if="kind === 'teams'"
                :to="`${consoleMode ? '/admin' : ''}/projects/${t.id}`"
                >{{ t.name }}</RouterLink
              ><strong v-else>{{ t.name }}</strong
              ><small>{{ t.code }}</small>
            </div>
            <ElButton
              v-if="kind === 'projects' && detail.can_manage"
              :disabled="busy"
              @click="removeTeam(t)"
              >移除授权</ElButton
            >
          </div>
          <p v-if="!teams.length" class="collab-empty">
            暂无{{ kind === "projects" ? "参与团队" : "可见关联项目" }}
          </p>
        </section>
        <footer class="lifecycle-actions">
          <ElButton
            v-if="detail.direct_role"
            :disabled="busy"
            @click="lifecycle('leave')"
            >退出{{ label }}</ElButton
          ><template v-if="consoleMode && identity.isAdmin"
            ><ElButton
              v-if="kind === 'projects'"
              :disabled="busy"
              @click="
                lifecycle(detail.status === 'active' ? 'archive' : 'restore')
              "
              >{{ detail.status === "active" ? "归档" : "恢复" }}项目</ElButton
            ><ElButton
              v-else-if="detail.status === 'active'"
              type="danger"
              plain
              :disabled="busy"
              @click="lifecycle('dissolve')"
              >解散团队</ElButton
            ></template
          >
        </footer>
      </template>
      <ElDialog
        v-model="editor"
        :title="`${creating ? '创建' : '编辑'}${label}`"
        width="700px"
        :before-close="closeEditor"
        :close-on-click-modal="false"
        :close-on-press-escape="!busy"
        :show-close="!busy"
        append-to-body
      >
        <p v-if="formError" role="alert" class="collab-error">
          {{ formError }}
        </p>
        <ElForm label-position="top" :disabled="busy" @submit.prevent="save"
          ><ElFormItem label="编码" :error="fieldErrors.code" required
            ><ElInput
              v-model="form.code"
              :disabled="!creating"
              maxlength="64"
            /><small
              >保留大小写，唯一性比较不区分大小写；创建后不可修改。</small
            ></ElFormItem
          ><ElFormItem label="名称" :error="fieldErrors.name" required
            ><ElInput v-model="form.name" maxlength="100" /></ElFormItem
          ><ElFormItem label="图标"
            ><div class="icon-picker">
              <button
                type="button"
                :disabled="busy"
                :aria-pressed="form.icon === ''"
                @click="chooseIcon('')"
              >
                默认</button
              ><button
                v-for="key in iconKeys"
                :key="key"
                type="button"
                :disabled="busy"
                :title="iconLabels[key]"
                :aria-label="iconLabels[key]"
                :aria-pressed="form.icon === key"
                @click="chooseIcon(key)"
              >
                <ResourceIcon :icon-key="key" />
              </button></div></ElFormItem
          ><ElFormItem label="自定义图标"
            ><AvatarEditor
              v-if="editor"
              ref="iconEditor"
              v-model="iconChange"
              upload-path="/icon-uploads"
              label="项目或团队图标"
              :disabled="busy"
              :avatar="
                !creating && form.icon === 'upload' && detail?.icon_file_id
                  ? {
                      id: detail.icon_file_id,
                      url: `/api/v1/icons/${detail.icon_file_id}`,
                    }
                  : null
              "
              @processing="iconProcessing = $event" /></ElFormItem
          ><ElFormItem label="摘要" :error="fieldErrors.summary"
            ><ElInput
              v-model="form.summary"
              type="textarea"
              :rows="2"
              maxlength="300"
              show-word-limit /></ElFormItem
          ><ElFormItem label="简介 · Markdown" :error="fieldErrors.description"
            ><div class="description-editor">
              <ElCheckbox v-model="preview">预览</ElCheckbox>
              <div
                v-if="preview"
                class="markdown-content preview"
                v-html="renderDescription(form.description)"
              />
              <ElInput
                v-else
                v-model="form.description"
                type="textarea"
                :rows="10"
              /></div></ElFormItem
          ><ElFormItem
            v-if="creating"
            label="初始管理员"
            :error="fieldErrors.admin_user_ids"
            required
            ><ElSelect
              v-model="form.admins"
              multiple
              filterable
              remote
              :remote-method="searchUsers"
              placeholder="搜索账号或显示名称"
              ><ElOption
                v-for="u in options"
                :key="u.id"
                :value="u.id"
                :label="`${u.display_name} (@${u.username})`" /></ElSelect></ElFormItem></ElForm
        ><template #footer
          ><ElButton :disabled="busy" @click="closeEditor()">取消</ElButton
          ><ElButton
            type="primary"
            :loading="busy"
            :disabled="iconProcessing"
            @click="save"
            >保存</ElButton
          ></template
        >
      </ElDialog>
      <ElDialog
        v-model="grantOpen"
        :title="grantType === 'user' ? '添加成员' : '添加团队'"
        width="500px"
        :close-on-click-modal="false"
        :show-close="!busy"
        :close-on-press-escape="!busy"
        append-to-body
        ><p v-if="error" class="collab-error" role="alert">{{ error }}</p>
        <ElForm label-position="top" :disabled="busy"
          ><ElFormItem :label="grantType === 'user' ? '用户' : '团队'"
            ><ElSelect
              v-model="grantID"
              filterable
              remote
              :remote-method="searchGrants"
              placeholder="输入名称搜索"
              ><ElOption
                v-for="item in grantOptions"
                :key="item.id"
                :value="item.id"
                :label="
                  grantType === 'user'
                    ? `${item.display_name} (@${item.username})`
                    : `${item.name} (${item.code})`
                " /></ElSelect></ElFormItem
          ><ElFormItem v-if="grantType === 'user'" label="角色"
            ><ElSelect v-model="grantRole"
              ><ElOption value="member" label="成员" /><ElOption
                value="admin"
                label="管理员" /></ElSelect
          ></ElFormItem>
          <p v-else>团队成员将获得项目普通成员权限。</p></ElForm
        ><template #footer
          ><ElButton :disabled="busy" @click="grantOpen = false">取消</ElButton
          ><ElButton
            type="primary"
            :loading="busy"
            :disabled="!grantID"
            @click="addGrant"
            >添加</ElButton
          ></template
        ></ElDialog
      >
    </div></AppLayout
  >
</template>
<style scoped>
.collab-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin-bottom: 24px;
}
.collab-toolbar h1 {
  font-size: 26px;
  margin: 8px 0;
  overflow-wrap: anywhere;
}
.collab-toolbar h2 {
  font-size: 18px;
}
.collab-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.back-link,
.muted {
  color: var(--text-muted);
}
.collab-error {
  padding: 12px;
  background: var(--danger-soft);
  color: var(--danger);
  margin: 12px 0;
  border-radius: 8px;
}
.collab-filters {
  display: flex;
  gap: 12px;
  margin-bottom: 24px;
  align-items: center;
}
.collab-filters > .el-input {
  max-width: 400px;
}
.collab-filters > .el-select {
  width: 160px;
  flex-shrink: 0;
}
.resource-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(270px, 1fr));
  gap: 18px;
  margin-bottom: 24px;
}
.resource-card {
  display: block;
  padding: 24px;
  text-decoration: none;
  color: var(--text-primary);
}
.resource-card:hover {
  border-color: var(--brand);
}
.resource-card-heading {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
}
.resource-card-heading strong {
  flex: 1;
  overflow-wrap: anywhere;
}
.resource-card small,
code,
.resource-card p,
.resource-card footer {
  color: var(--text-muted);
}
.resource-card p {
  min-height: 42px;
  overflow-wrap: anywhere;
}
.resource-card footer {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
}
.resource-summary {
  padding: 24px;
  display: flex;
  gap: 20px;
  align-items: center;
}
.resource-summary > .resource-icon {
  width: 48px;
  height: 48px;
}
.resource-summary > div {
  flex: 1;
}
.resource-summary p {
  margin: 8px 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.collab-tabs {
  display: flex;
  gap: 8px;
  margin: 24px 0;
}
.description,
.members-panel {
  padding: 24px;
}
.collab-empty {
  text-align: center;
  color: var(--text-muted);
  padding: 40px 20px;
}
.collab-table-wrap {
  overflow: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
}
th,
td {
  padding: 16px 10px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
td small,
.team-row small {
  display: block;
  color: var(--text-muted);
  margin-top: 4px;
}
.source-tag {
  display: inline-block;
  background: var(--surface-subtle);
  padding: 4px 8px;
  margin: 3px;
  border-radius: 5px;
  font-size: 12px;
}
.team-row {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 16px 0;
  border-bottom: 1px solid var(--border);
}
.team-row > div {
  flex: 1;
}
.lifecycle-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 24px;
  gap: 8px;
}
.icon-picker {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.icon-picker button {
  background: var(--surface);
  color: var(--text-primary);
  border: 1px solid var(--border);
  padding: 8px;
  border-radius: 8px;
  cursor: pointer;
}
.icon-picker button[aria-pressed="true"] {
  border-color: var(--brand);
  background: var(--surface-subtle);
}
.description-editor {
  width: 100%;
}
.preview {
  padding: 16px;
  border: 1px solid var(--border);
  min-height: 200px;
}
.markdown-content {
  overflow-wrap: anywhere;
  line-height: 1.8;
}
.markdown-content :deep(pre) {
  overflow: auto;
  background: var(--surface-subtle);
  padding: 16px;
  border-radius: 6px;
}
.markdown-content :deep(blockquote) {
  border-left: 3px solid var(--brand);
  padding-left: 16px;
  color: var(--text-muted);
}
.markdown-content :deep(table) {
  border-collapse: collapse;
}
.markdown-content :deep(td),
.markdown-content :deep(th) {
  border: 1px solid var(--border);
  padding: 8px;
}
.markdown-content :deep(a) {
  color: var(--brand);
  text-decoration: underline;
}
@media (max-width: 650px) {
  .collab-toolbar,
  .collab-filters {
    flex-wrap: wrap;
  }
  .collab-actions {
    flex-wrap: wrap;
  }
  .collab-toolbar h1 {
    font-size: 22px;
  }
  .resource-summary {
    padding: 16px;
  }
  .description,
  .members-panel {
    padding: 16px;
  }
  .resource-grid {
    grid-template-columns: 1fr;
  }
  .collab-tabs {
    flex-wrap: wrap;
  }
}
</style>
