<script setup lang="ts">
import PageSizeSelect from "../../shared/PageSizeSelect.vue";
import StatusSegmented from "../../shared/StatusSegmented.vue";
import ClearFiltersButton from "../../shared/ClearFiltersButton.vue";
import { computed, ref, reactive, watch, onUnmounted, nextTick } from "vue";
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
  ElDropdown,
  ElDropdownMenu,
  ElDropdownItem,
  ElPopover,
} from "element-plus";
import UiIcon from "../../shared/UiIcon.vue";
import UserAvatar from "../../shared/UserAvatar.vue";
import RefreshButton from "../../shared/RefreshButton.vue";
import { useListSearch } from "../../shared/listSearch";
import "./collaboration.css";
import AppLayout from "../../app/AppLayout.vue";
import { api, request, ApiError } from "../../shared/api";
import { useIdentity, errorMessage } from "../identity/store";
import { useShortcuts } from "./sidebar";
import ResourceIcon from "./ResourceIcon.vue";
import ProjectRepositories from "./ProjectRepositories.vue";
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
const unifiedListControls = computed(() => consoleMode.value || kind.value === "teams");
const base = computed(
  () => `${consoleMode.value ? "/admin" : ""}/${kind.value}`,
);
const id = computed(() => String(route.params.id || ""));
const rows = ref<Resource[]>([]),
  total = ref(0),
  page = ref(1),
  query = ref(""),
  status = ref("active");
const detail = ref<Resource>(),
  members = ref<Member[]>([]),
  teams = ref<Resource[]>([]);
const memberPage = ref(1),
  memberTotal = ref(0),
  memberSearch = ref("");
watch(memberPage, load);
const listPageSize = ref(20);
const loading = ref(false),
  busy = ref(false),
  error = ref(""),
  tab = computed({
    get: () => {
      const value = String(route.query.tab);
      if (kind.value === "teams" && value === "projects") return "teams";
      if (kind.value === "projects" && value === "repositories") return value;
      return ["members", "teams"].includes(value) ? value : "overview";
    },
    set: (value) => {
      void router.replace({
        query: {
          ...route.query,
          tab:
            value === "overview"
              ? undefined
              : value === "teams" && kind.value === "teams"
                ? "projects"
                : value,
        },
      });
    },
  });
const counts = ref<Record<string, number>>({});
const endStatus = computed(() =>
  kind.value === "projects" ? "archived" : "dissolved",
);
const filters = computed(() => [
  { value: "active", label: "正常" },
  {
    value: endStatus.value,
    label: kind.value === "projects" ? "已归档" : "已解散",
  },
  { value: "all", label: "全部" },
]);
const fallbackIcon = computed(() =>
  kind.value === "teams" ? "team" : "folder",
);
const pinBusy = ref(false);
const iconPicker = ref(false);
const formElement = ref<HTMLElement>();
function roleLabel(resource: Resource) {
  return resource.direct_role === "admin"
    ? "管理员"
    : resource.is_member
      ? "成员"
      : "未加入";
}
function isPinned(resource: Resource) {
  return shortcuts.groups[kind.value].items.some(
    (item) => item.id === resource.id,
  );
}
async function togglePin(resource: Resource) {
  if (pinBusy.value) return;
  const group = kind.value;
  const expectedPinned = isPinned(resource);
  pinBusy.value = true;
  try {
    // Refresh once before constructing the whole-group write; the ETag still
    // rejects concurrent changes between this read and the save.
    await shortcuts.refresh();
    const current = shortcuts.groups[group];
    const pinned = current.items.some((item) => item.id === resource.id);
    if (pinned !== expectedPinned) {
      ElMessage.warning("固定状态已在其他位置更新，请重新操作");
      return;
    }
    const ids = current.items
      .map((item) => item.id)
      .filter((id) => id !== resource.id);
    if (!pinned) ids.push(resource.id);
    await shortcuts.save(group, ids, current.etag);
    ElMessage.success(pinned ? "已取消固定" : "已固定到侧栏");
  } catch (e) {
    if (e instanceof ApiError && e.code === "VERSION_CONFLICT") {
      await shortcuts.refresh().catch(() => {});
      ElMessage.warning("快捷方式已在其他位置更新，请重新操作");
    } else {
      await shortcuts.refresh().catch(() => {});
      ElMessage.error(errorMessage(e));
    }
  } finally {
    pinBusy.value = false;
  }
}
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
const listSearch = useListSearch(
  () => {
    if (page.value !== 1) page.value = 1;
    else void load();
  },
  () => {
    loadSequence++;
  },
);
const memberQuery = useListSearch(
  () => {
    if (memberPage.value !== 1) memberPage.value = 1;
    else void load();
  },
  () => {
    loadSequence++;
  },
);
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
  loadSequence++;
  optionSequence++;
  window.removeEventListener("beforeunload", beforeUnload);
});
async function load() {
  const seq = ++loadSequence,
    currentKind = kind.value,
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
          `${endpoint}/${current}/${currentKind === "projects" ? "teams" : "projects"}`,
        ),
      ]);
      if (seq !== loadSequence) return;
      detail.value = value;
      members.value = results[0].items;
      memberTotal.value = results[0].total;
      detail.value.membership_etag = results[0].membership_etag;
      teams.value = results[1];
    } else {
      const common = `scope=${consoleMode.value ? "all" : "mine"}&q=${encodeURIComponent(query.value)}`;
      const [result, active, ended] = await Promise.all([
        api<Page>(
          `${endpoint}?${common}&status=${status.value}&page=${page.value}&page_size=${unifiedListControls.value ? listPageSize.value : 20}`,
        ),
        api<Page>(`${endpoint}?${common}&status=active&page=1&page_size=1`),
        api<Page>(
          `${endpoint}?${common}&status=${endStatus.value}&page=1&page_size=1`,
        ),
      ]);
      if (seq !== loadSequence) return;
      rows.value = result.items;
      total.value = result.total;
      counts.value = {
        active: active.total,
        [endStatus.value]: ended.total,
        all: active.total + ended.total,
      };
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
    listSearch.cancel();
    memberQuery.cancel();
    page.value = 1;
    memberPage.value = 1;
    memberSearch.value = "";
    detail.value = undefined;
    editor.value = false;
    grantOpen.value = false;
    rows.value = [];
    total.value = 0;
    counts.value = {};
    query.value = "";
    status.value = "active";
    void load();
  },
  { immediate: true },
);
watch(status, () => {
  listSearch.cancel();
  if (page.value !== 1) page.value = 1;
  else void load();
});
watch(page, load);
watch(listPageSize, () => {
  listSearch.cancel();
  if (page.value !== 1) page.value = 1;
  else void load();
});
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
  iconPicker.value = false;
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
  if (Object.keys(fieldErrors.value).length) {
    await focusFieldError();
    return;
  }
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
    await focusFieldError();
  } finally {
    busy.value = false;
  }
}
async function focusFieldError() {
  await nextTick();
  formElement.value
    ?.querySelector<HTMLElement>(
      ".is-error input, .is-error textarea, .is-error [role=combobox]",
    )
    ?.focus();
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
async function detailCommand(command: string) {
  if (busy.value) return;
  if (command === "edit") {
    if (detail.value?.can_manage) await edit();
  } else if (command === "refresh") {
    if (!loading.value) await load();
  } else {
    await lifecycle(command);
  }
}
async function lifecycle(op: string) {
  const d = detail.value;
  if (!d || busy.value) return;
  try {
    if (op === "dissolve") {
      await ElMessageBox.prompt(
        `解散“${d.name}”将移除所有成员和项目授权，且不能恢复。请输入团队编码 ${d.code} 确认。`,
        "解散团队",
        {
          confirmButtonText: "解散团队",
          cancelButtonText: "取消",
          type: "warning",
          inputValidator: (value) =>
            value.trim().toLowerCase() === d.code.toLowerCase() ||
            "团队编码不匹配",
        },
      );
    } else
      await ElMessageBox.confirm(
        op === "archive"
          ? `归档“${d.name}”后项目仅可查看，系统管理员可恢复。`
          : op === "leave"
            ? `退出“${d.name}”会移除你的直接成员身份。其他团队带来的项目权限仍会保留。`
            : `确定恢复“${d.name}”？`,
        `${op === "archive" ? "归档" : op === "leave" ? "退出" : "恢复"}${label.value}`,
        {
          confirmButtonText: "确认",
          cancelButtonText: "取消",
          type: "warning",
        },
      );
  } catch {
    return;
  }
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
  <AppLayout :breadcrumbs="id ? [
    { label: consoleMode ? '控制台' : '首页', to: consoleMode ? '/admin' : '/home' },
    { label: consoleMode ? `${label}管理` : `我的${label}`, to: base },
    { label: detail?.id === id ? detail.name : `${label}详情` },
  ] : undefined">
    <div class="collaboration-page" :aria-busy="loading">
      <div v-if="error" class="collab-error" role="alert">
        <span>{{ error }}</span
        ><ElButton :disabled="loading || busy" @click="load">重新加载</ElButton>
      </div>
      <template v-if="!id">
        <div v-if="unifiedListControls" class="table-toolbar console-list-toolbar collab-console-toolbar">
          <label class="search-box"><UiIcon name="search" /><input
            v-model="query" type="search" :aria-label="`搜索${label}`" placeholder="搜索名称、编码或摘要" autocomplete="off"
            @input="listSearch.input" @keydown.enter="listSearch.enter"
            @compositionstart="listSearch.compositionStart" @compositionend="listSearch.compositionEnd"
          /></label>
          <StatusSegmented v-model="status" :options="filters.map(filter => ({ ...filter, count: error ? undefined : counts[filter.value] }))" />
          <ClearFiltersButton :disabled="!query && status === 'active'" @click="query = ''; status = 'active'; listSearch.run()" />
          <RefreshButton :loading="loading" :disabled="busy" @click="listSearch.run" />
          <div v-if="consoleMode" class="console-create-action"><ElButton class="console-create" type="primary" @click="edit(true)"><UiIcon name="plus" />创建{{ label }}</ElButton></div>
        </div>
        <div v-else class="collab-toolbar">
          <nav class="collab-status-tabs" aria-label="状态筛选">
            <button
              v-for="filter in filters"
              :key="filter.value"
              :class="{ active: status === filter.value }"
              :aria-pressed="status === filter.value"
              @click="status = filter.value"
            >
              {{ filter.label
              }}<span
                v-if="counts[filter.value] !== undefined && !error"
                class="collab-count"
                >{{ counts[filter.value] }}</span
              >
            </button>
          </nav>
          <div class="collab-actions">
            <label class="collab-search"
              ><UiIcon name="search" /><input
                v-model="query"
                type="search"
                :aria-label="`搜索${label}`"
                placeholder="搜索名称、编码或摘要"
                autocomplete="off"
                @input="listSearch.input"
                @keydown.enter="listSearch.enter"
                @compositionstart="listSearch.compositionStart"
                @compositionend="listSearch.compositionEnd"
            /></label>
            <RefreshButton
              :loading="loading"
              :disabled="busy"
              aria-label="刷新"
              @click="listSearch.run"
              ></RefreshButton
            >
            <ElButton v-if="consoleMode" type="primary" @click="edit(true)"
              ><UiIcon name="plus" />创建{{ label }}</ElButton
            >
          </div>
        </div>
        <div v-if="loading && !rows.length" class="collab-empty" role="status">
          正在加载{{ label }}…
        </div>
        <div v-else-if="!error && !rows.length" class="collab-empty">
          <ResourceIcon :fallback="fallbackIcon" tile />
          <h2>
            {{
              query
                ? "没有匹配结果"
                : `暂无${status === "active" ? "" : status === "all" ? "" : statusLabel(status)}${label}`
            }}
          </h2>
          <p>
            {{
              query || status === endStatus
                ? "当前筛选条件下没有结果，可切换状态或清除筛选。"
                : consoleMode
                  ? `创建${label}后，即可添加成员开始协作。`
                  : `你参与的${label}会显示在这里。需要加入时，请联系${label}或系统管理员。`
            }}
          </p>
          <ClearFiltersButton v-if="!unifiedListControls && (query || status !== 'active')" @click="query = ''; status = 'active'; listSearch.run()" />
        </div>
        <template v-else-if="rows.length">
          <div v-if="consoleMode" class="collab-table-panel">
            <div class="collab-table-wrap">
              <table class="collab-table">
                <thead>
                  <tr>
                    <th>{{ label }}</th>
                    <th>摘要</th>
                    <th>状态</th>
                    <th>成员</th>
                    <th class="collab-operation">操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in rows" :key="item.id">
                    <td>
                      <div class="collab-resource-cell">
                        <ResourceIcon
                          :icon-key="item.icon_key"
                          :file-id="item.icon_file_id"
                          :fallback="fallbackIcon"
                          tile
                        />
                        <div>
                          <RouterLink :to="`${base}/${item.id}`">{{
                            item.name
                          }}</RouterLink
                          ><code>{{ item.code }}</code>
                        </div>
                      </div>
                    </td>
                    <td class="collab-summary-cell">
                      <span :title="item.summary">{{
                        item.summary || "暂未填写摘要"
                      }}</span>
                    </td>
                    <td>
                      <span
                        class="collab-status"
                        :class="{ ended: item.status !== 'active' }"
                        >{{ statusLabel(item.status) }}</span
                      >
                    </td>
                    <td class="collab-nowrap">{{ item.member_count }} 人</td>
                    <td>
                      <RouterLink
                        class="icon-btn"
                        :to="`${base}/${item.id}`"
                        :aria-label="`查看${item.name}`"
                        ><UiIcon name="chevron"
                      /></RouterLink>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div v-else-if="kind === 'projects'" class="resource-grid">
            <article v-for="item in rows" :key="item.id" class="resource-card">
              <div class="resource-card-heading">
                <ResourceIcon
                  :icon-key="item.icon_key"
                  :file-id="item.icon_file_id"
                  tile
                />
                <div class="resource-card-title">
                  <RouterLink :to="`${base}/${item.id}`" :title="item.name">{{
                    item.name
                  }}</RouterLink
                  ><code>{{ item.code }}</code>
                </div>
              </div>
              <button
                class="icon-btn collab-card-pin"
                :class="{ pinned: isPinned(item) }"
                :disabled="pinBusy"
                :aria-pressed="isPinned(item)"
                :aria-label="`${isPinned(item) ? '取消固定' : '固定'}${item.name}`"
                :title="isPinned(item) ? '取消固定' : '固定到侧栏'"
                @click="togglePin(item)"
              >
                <UiIcon name="pin" />
              </button>
              <p class="resource-card-summary">
                {{ item.summary || "暂未填写摘要" }}
              </p>
              <footer>
                <span class="collab-member-count"
                  ><UiIcon name="users" />{{ item.member_count }} 位成员</span
                ><span class="collab-role">{{
                  roleLabel(item)
                }}</span
                ><span class="collab-status" :class="{ ended: item.status !== 'active' }">{{
                  statusLabel(item.status)
                }}</span>
              </footer>
            </article>
          </div>
          <div v-else class="collab-team-list">
            <article
              v-for="item in rows"
              :key="item.id"
              class="collab-team-row"
            >
              <ResourceIcon
                :icon-key="item.icon_key"
                :file-id="item.icon_file_id"
                fallback="team"
                tile
              />
              <div class="collab-team-info">
                <RouterLink :to="`${base}/${item.id}`">{{
                  item.name
                }}</RouterLink
                ><code>{{ item.code }}</code>
                <p>{{ item.summary || "暂未填写摘要" }}</p>
              </div>
              <div class="collab-team-meta">
                <span class="collab-member-count"
                  ><UiIcon name="users" />{{ item.member_count }} 位成员</span
                ><span class="collab-role">{{ roleLabel(item) }}</span
                ><button
                  class="icon-btn"
                  :class="{ pinned: isPinned(item) }"
                  :disabled="pinBusy"
                  :aria-pressed="isPinned(item)"
                  :aria-label="`${isPinned(item) ? '取消固定' : '固定'}${item.name}`"
                  @click="togglePin(item)"
                >
                  <UiIcon name="pin" />
                </button>
              </div>
            </article>
          </div>
          <footer v-if="!error && !unifiedListControls" class="collab-list-footer">
            <span
              >共 {{ total }} 个{{ label
              }}</span
            ><ElPagination
              v-if="total > 20"
              v-model:current-page="page"
              :total="total"
              :page-size="20"
              layout="prev, pager, next"
            />
          </footer>
        </template>
        <footer v-if="unifiedListControls && !error" class="table-footer collab-console-footer">
          <div class="list-page-summary">
            <span>共 {{ total }} 个{{ label }}</span>
            <PageSizeSelect v-model="listPageSize" :disabled="loading" />
          </div>
          <div class="pagination">
            <button class="page-button" :disabled="page <= 1 || loading" aria-label="上一页" @click="page--"><UiIcon name="chevron-left" /></button>
            <span>{{ page }} / {{ Math.max(1, Math.ceil(total / listPageSize)) }}</span>
            <button class="page-button" :disabled="page * listPageSize >= total || loading" aria-label="下一页" @click="page++"><UiIcon name="chevron" /></button>
          </div>
        </footer>
      </template>
      <template v-else-if="detail">
        <section class="collab-detail-heading">
          <ResourceIcon
            :icon-key="detail.icon_key"
            :file-id="detail.icon_file_id"
            :fallback="fallbackIcon"
            tile
          />
          <div class="collab-identity">
            <div class="collab-title-line">
              <h1>{{ detail.name }}</h1>
              <span
                class="collab-status"
                :class="{ ended: detail.status !== 'active' }"
                >{{ statusLabel(detail.status) }}</span
              >
            </div>
            <div class="collab-identity-line"><code>{{ detail.code }}</code></div>
            <p v-if="detail.summary">{{ detail.summary }}</p>
          </div>
          <div class="collab-detail-actions">
            <button
              v-if="detail.is_member"
              class="icon-btn"
              :disabled="pinBusy"
              :aria-pressed="isPinned(detail)"
              :aria-label="isPinned(detail) ? '取消固定' : '固定到侧栏'"
              :title="isPinned(detail) ? '取消固定' : '固定到侧栏'"
              :class="{ pinned: isPinned(detail) }"
              @click="togglePin(detail)"
              ><UiIcon name="pin" /></button
            >
            <ElDropdown
              trigger="click"
              placement="bottom-end"
              popper-class="collab-detail-dropdown"
              :disabled="busy"
              @command="detailCommand"
            >
              <button class="icon-btn" :disabled="busy" aria-label="更多操作">
                <UiIcon name="more" />
              </button>
              <template #dropdown
                ><ElDropdownMenu>
                  <ElDropdownItem v-if="detail.can_manage" command="edit"
                    ><UiIcon name="edit" />编辑资料</ElDropdownItem
                  >
                  <ElDropdownItem command="refresh" :disabled="loading"
                    ><UiIcon name="refresh" />刷新</ElDropdownItem
                  >
                  <ElDropdownItem v-if="detail.direct_role" command="leave" divided
                    ><UiIcon name="logout" />退出{{ label }}</ElDropdownItem
                  >
                  <template v-if="consoleMode && identity.isAdmin"
                    ><ElDropdownItem
                      v-if="kind === 'projects'"
                      :divided="!detail.direct_role"
                      :command="
                        detail.status === 'active' ? 'archive' : 'restore'
                      "
                      ><UiIcon :name="detail.status === 'active' ? 'archive' : 'rotate'" />{{
                        detail.status === "active" ? "归档项目" : "恢复项目"
                      }}</ElDropdownItem
                    ><ElDropdownItem
                      v-else-if="detail.status === 'active'"
                      :divided="!detail.direct_role"
                      command="dissolve"
                      class="collab-danger"
                      ><UiIcon name="block" />解散团队</ElDropdownItem
                    ></template
                  >
                </ElDropdownMenu></template
              >
            </ElDropdown>
          </div>
        </section>
        <p v-if="detail.status !== 'active'" class="collab-readonly">
          {{ label }}{{ statusLabel(detail.status) }}，当前仅可查看历史资料。
        </p>
        <nav class="collab-tabs" aria-label="详情导航">
          <button
            :class="{ active: tab === 'overview' }"
            :aria-current="tab === 'overview' ? 'page' : undefined"
            @click="tab = 'overview'"
          >
            <UiIcon name="log" />概览
          </button>
          <button
            :class="{ active: tab === 'members' }"
            :aria-current="tab === 'members' ? 'page' : undefined"
            @click="tab = 'members'"
          >
            <UiIcon name="users" />成员<span class="collab-count">{{
              detail.member_count
            }}</span>
          </button>
          <button
            :class="{ active: tab === 'teams' }"
            :aria-current="tab === 'teams' ? 'page' : undefined"
            @click="tab = 'teams'"
          >
            <UiIcon :name="kind === 'projects' ? 'users' : 'folder'" />{{
              kind === "projects" ? "参与团队" : "加入项目"
            }}<span class="collab-count">{{ teams.length }}</span>
          </button>
          <button v-if="kind === 'projects'" :class="{ active: tab === 'repositories' }" @click="tab = 'repositories'">Git 仓库</button>
          <RouterLink v-if="kind === 'projects' && (detail.direct_role === 'admin' || identity.isAdmin)" :to="`/projects/${detail.id}/integrations`" class="tab">集成凭证</RouterLink>
          <RouterLink v-if="kind === 'projects' && (detail.direct_role === 'admin' || identity.isAdmin)" :to="`/projects/${detail.id}/remote-hosts`" class="tab">SSH 凭证</RouterLink>
        </nav>
        <div v-if="tab === 'overview'" class="collab-overview-grid">
          <article class="collab-document">
            <h2 class="collab-section-label">
              <UiIcon name="log" />{{ label }}简介
            </h2>
            <div
              v-if="detail.description"
              class="markdown-content"
              v-html="html"
            />
            <div v-else class="collab-empty">
              <p>暂未填写简介</p>
              <ElButton v-if="detail.can_manage" text @click="edit()"
                >添加简介</ElButton
              >
            </div>
          </article>
          <aside class="collab-info">
            <h2>基本信息</h2>
            <dl>
              <dt>{{ label }}编码</dt>
              <dd>
                <code>{{ detail.code }}</code>
              </dd>
              <dt>当前状态</dt>
              <dd>
                <span
                  class="collab-status"
                  :class="{ ended: detail.status !== 'active' }"
                  >{{ statusLabel(detail.status) }}</span
                >
              </dd>
              <dt>我的角色</dt>
              <dd>{{ roleLabel(detail) }}</dd>
              <dt>成员人数</dt>
              <dd>{{ detail.member_count }} 人</dd>
              <dt>{{ kind === "projects" ? "参与团队" : "加入项目" }}</dt>
              <dd>{{ teams.length }} 个</dd>
            </dl>
            <p>
              {{
                kind === "projects"
                  ? "成员可以直接加入，也可以通过参与团队获得访问权限。"
                  : "团队成员通过授权加入项目，协作关系集中管理。"
              }}
            </p>
          </aside>
        </div>
        <ProjectRepositories v-else-if="tab === 'repositories' && kind === 'projects'" :project-id="detail.id" :can-manage="consoleMode && identity.isAdmin && detail.status === 'active'" />
        <section v-else-if="tab === 'members'" aria-label="成员">
          <div class="collab-members-toolbar">
            <label class="collab-search"
              ><UiIcon name="search" /><input
                v-model="memberSearch"
                type="search"
                placeholder="搜索成员名称或账号"
                aria-label="搜索成员"
                autocomplete="off"
                @input="memberQuery.input"
                @keydown.enter="memberQuery.enter"
                @compositionstart="memberQuery.compositionStart"
                @compositionend="memberQuery.compositionEnd" /></label
            ><ElButton
              v-if="detail.can_manage"
              type="primary"
              :disabled="busy"
              @click="openGrant('user')"
              ><UiIcon name="plus" />添加成员</ElButton
            >
          </div>
          <div class="collab-table-panel">
            <div v-if="members.length" class="collab-table-wrap">
              <table class="collab-table">
                <thead>
                  <tr>
                    <th>成员</th>
                    <th>权限来源</th>
                    <th>角色</th>
                    <th v-if="detail.can_manage" class="collab-operation">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="m in members" :key="m.user_id">
                    <td>
                      <div class="collab-person">
                        <UserAvatar :user="{ avatar: null }" />
                        <div>
                          <strong>{{ m.display_name }}</strong
                          ><small
                            >@{{ m.username
                            }}<span v-if="m.account_status !== 'active'">
                              · 已停用</span
                            ></small
                          >
                        </div>
                      </div>
                    </td>
                    <td>
                      <div class="collab-sources">
                        <span
                          v-for="(source, i) in m.sources.slice(0, 2)"
                          :key="i"
                          class="source-tag"
                          >{{
                            source.type === "direct"
                              ? "直接加入"
                              : source.team_name
                          }}</span
                        ><ElPopover
                          v-if="m.sources.length > 2"
                          trigger="click"
                          placement="bottom"
                          :width="240"
                          ><template #reference
                            ><button
                              class="collab-source-more"
                              :aria-label="`查看${m.display_name}的其他权限来源`"
                            >
                              另有 {{ m.sources.length - 2 }} 个来源
                            </button></template
                          ><span
                            v-for="(source, i) in m.sources.slice(2)"
                            :key="i"
                            class="source-tag"
                            >{{
                              source.type === "direct"
                                ? "直接加入"
                                : source.team_name
                            }}</span
                          ></ElPopover
                        >
                      </div>
                    </td>
                    <td>
                      <span
                        :class="
                          m.effective_role === 'admin'
                            ? 'collab-role'
                            : 'collab-muted'
                        "
                        >{{
                          m.effective_role === "admin" ? "管理员" : "成员"
                        }}</span
                      >
                    </td>
                    <td v-if="detail.can_manage">
                      <ElDropdown
                        v-if="m.direct_role"
                        trigger="click"
                        :disabled="busy"
                        ><button
                          class="icon-btn"
                          :disabled="busy"
                          :aria-label="`管理${m.display_name}`"
                        >
                          <UiIcon name="more" /></button
                        ><template #dropdown
                          ><ElDropdownMenu
                            ><ElDropdownItem
                              @click="
                                action(
                                  `/${kind}/${id}/members/${m.user_id}`,
                                  'PATCH',
                                  {
                                    role:
                                      m.direct_role === 'admin'
                                        ? 'member'
                                        : 'admin',
                                  },
                                  detail.membership_etag,
                                )
                              "
                              >{{
                                m.direct_role === "admin"
                                  ? "设为成员"
                                  : "设为管理员"
                              }}</ElDropdownItem
                            ><ElDropdownItem
                              class="collab-danger"
                              @click="removeMember(m)"
                              >移除直接身份</ElDropdownItem
                            ></ElDropdownMenu
                          ></template
                        ></ElDropdown
                      ><span v-else class="collab-muted collab-nowrap"
                        >团队管理</span
                      >
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-else class="collab-empty">
              {{ memberSearch ? "没有匹配的成员。" : "暂无成员。" }}
            </p>
            <footer v-if="!error" class="collab-list-footer">
              <span>共 {{ memberTotal }} 位成员</span
              ><ElPagination
                v-if="memberTotal > 20"
                v-model:current-page="memberPage"
                :total="memberTotal"
                :page-size="20"
                layout="prev, pager, next"
              />
            </footer>
          </div>
          <p v-if="kind === 'projects'" class="collab-help">
            团队成员继承项目访问权限；项目管理员权限由项目直接授予。
          </p>
        </section>
        <section
          v-else
          :aria-label="kind === 'projects' ? '参与团队' : '加入项目'"
        >
          <div class="collab-members-toolbar">
            <span class="collab-muted">{{
              kind === "projects"
                ? "通过团队授权参与此项目"
                : "当前团队已加入且你可访问的项目"
            }}</span
            ><ElButton
              v-if="kind === 'projects' && detail.can_manage"
              type="primary"
              :disabled="busy"
              @click="openGrant('team')"
              ><UiIcon name="plus" />添加团队</ElButton
            >
          </div>
          <div v-if="teams.length" class="collab-team-list">
            <article v-for="t in teams" :key="t.id" class="collab-team-row">
              <ResourceIcon
                :icon-key="t.icon_key"
                :file-id="t.icon_file_id"
                :fallback="kind === 'projects' ? 'team' : 'folder'"
                tile
              />
              <div class="collab-team-info">
                <RouterLink
                  v-if="kind === 'teams'"
                  :to="`${consoleMode ? '/admin' : ''}/projects/${t.id}`"
                  >{{ t.name }}</RouterLink
                ><strong v-else>{{ t.name }}</strong
                ><code>{{ t.code }}</code>
                <p>{{ t.summary || "暂未填写摘要" }}</p>
              </div>
              <div class="collab-team-meta">
                <ElDropdown
                  v-if="kind === 'projects' && detail.can_manage"
                  trigger="click"
                  :disabled="busy"
                  ><button
                    class="icon-btn"
                    :disabled="busy"
                    :aria-label="`管理${t.name}授权`"
                  >
                    <UiIcon name="more" /></button
                  ><template #dropdown
                    ><ElDropdownMenu
                      ><ElDropdownItem
                        class="collab-danger"
                        @click="removeTeam(t)"
                        >移除授权</ElDropdownItem
                      ></ElDropdownMenu
                    ></template
                  ></ElDropdown
                ><RouterLink
                  v-else-if="kind === 'teams'"
                  class="icon-btn"
                  :to="`${consoleMode ? '/admin' : ''}/projects/${t.id}`"
                  :aria-label="`查看${t.name}`"
                  ><UiIcon name="chevron"
                /></RouterLink>
              </div>
            </article>
          </div>
          <p v-else class="collab-empty">
            暂无{{ kind === "projects" ? "参与团队" : "可见的已加入项目" }}
          </p>
        </section>
      </template>
      <p v-else-if="loading" class="collab-empty" role="status">
        正在加载{{ label }}…
      </p>
      <ElDialog
        v-model="editor"
        :title="`${creating ? '创建' : '编辑'}${label}`"
        width="660px"
        class="collab-editor-dialog"
        :before-close="closeEditor"
        :close-on-click-modal="false"
        :close-on-press-escape="!busy && !iconProcessing"
        :show-close="!busy && !iconProcessing"
        append-to-body
      >
        <div ref="formElement">
          <p v-if="formError" role="alert" class="collab-error">
            {{ formError }}
          </p>
          <ElForm class="field-errors-form" label-position="top" :disabled="busy" @submit.prevent="save">
            <div class="collab-icon-field">
              <ResourceIcon
                :icon-key="form.icon"
                :image-url="
                  form.icon === 'upload' ? iconEditor?.preview : undefined
                "
                :fallback="fallbackIcon"
                tile
              />
              <div>
                <ElButton
                  :disabled="busy || iconProcessing"
                  :aria-expanded="iconPicker"
                  @click="iconPicker = !iconPicker"
                  >更换图标</ElButton
                >
              </div>
            </div>
            <div v-show="iconPicker" class="collab-icon-options">
              <div class="icon-picker">
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
                </button>
              </div>
              <AvatarEditor
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
                @processing="iconProcessing = $event"
              />
            </div>
            <div class="collab-form-grid">
              <ElFormItem label="名称" :error="fieldErrors.name" required
                ><ElInput
                  v-model="form.name"
                  maxlength="100"
                  @input="fieldErrors.name = ''" /></ElFormItem
              ><ElFormItem label="编码" :error="fieldErrors.code" required
                ><ElInput
                  v-model="form.code"
                  :readonly="!creating"
                  maxlength="64"
                  @input="fieldErrors.code = ''"
                /><small v-if="!fieldErrors.code" class="collab-field-help">{{
                  creating
                    ? "2–64 位字母、数字、下划线或连字符，首尾为字母或数字；创建后不可修改。"
                    : "创建后不可修改"
                }}</small></ElFormItem
              >
            </div>
            <ElFormItem label="摘要" :error="fieldErrors.summary"
              ><ElInput
                v-model="form.summary"
                type="textarea"
                :rows="2"
                maxlength="300"
                show-word-limit
                placeholder="用一两句话说明用途"
                @input="fieldErrors.summary = ''"
            /></ElFormItem>
            <ElFormItem
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
                @change="fieldErrors.admin_user_ids = ''"
                ><ElOption
                  v-for="u in options"
                  :key="u.id"
                  :value="u.id"
                  :label="`${u.display_name} (@${u.username})`" /></ElSelect
            ></ElFormItem>
            <ElFormItem :error="fieldErrors.description"
              ><div class="description-editor">
                <div class="collab-editor-label">
                  <label for="collab-description"
                    >简介 <small>Markdown</small></label
                  >
                  <div class="collab-segmented" aria-label="简介编辑方式">
                    <button
                      type="button"
                      :disabled="busy"
                      :class="{ active: !preview }"
                      :aria-pressed="!preview"
                      @click="preview = false"
                    >
                      编辑</button
                    ><button
                      type="button"
                      :disabled="busy"
                      :class="{ active: preview }"
                      :aria-pressed="preview"
                      @click="preview = true"
                    >
                      预览
                    </button>
                  </div>
                </div>
                <div
                  v-if="preview"
                  class="markdown-content preview"
                  v-html="
                    renderDescription(form.description) || '<p>暂无简介</p>'
                  "
                />
                <ElInput
                  v-else
                  id="collab-description"
                  v-model="form.description"
                  type="textarea"
                  :rows="7"
                  @input="fieldErrors.description = ''"
                /></div
            ></ElFormItem>
          </ElForm>
        </div>
        <template #footer
          ><ElButton :disabled="busy || iconProcessing" @click="closeEditor()"
            >取消</ElButton
          ><ElButton
            type="primary"
            :loading="busy"
            :disabled="iconProcessing"
            @click="save"
            >{{ creating ? `创建${label}` : "保存" }}</ElButton
          ></template
        >
      </ElDialog>
      <ElDialog
        v-model="grantOpen"
        :title="grantType === 'user' ? '添加成员' : '添加团队'"
        width="500px"
        class="collab-editor-dialog"
        :close-on-click-modal="false"
        :show-close="!busy"
        :close-on-press-escape="!busy"
        append-to-body
      >
        <p v-if="error" class="collab-error" role="alert">{{ error }}</p>
        <ElForm class="field-errors-form" label-position="top" :disabled="busy"
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
          <p v-else class="collab-muted">
            团队成员将获得项目普通成员权限。
          </p></ElForm
        ><template #footer
          ><ElButton :disabled="busy" @click="grantOpen = false">取消</ElButton
          ><ElButton
            type="primary"
            :loading="busy"
            :disabled="!grantID"
            @click="addGrant"
            >添加</ElButton
          ></template
        >
      </ElDialog>
    </div>
  </AppLayout>
</template>
