<script setup lang="ts">
import { ref, onMounted, watch, onUnmounted } from "vue";
import { ElButton, ElDialog, ElInput, ElMessage } from "element-plus";
import { useRoute } from "vue-router";
import { api } from "../../shared/api";
import { errorMessage } from "../identity/store";
import ResourceIcon from "./ResourceIcon.vue";
import { useShortcuts } from "./sidebar";
import type { Kind, Page, Resource } from "./model";
const store = useShortcuts(),
  route = useRoute();
const kind = ref<Kind>("projects"),
  open = ref(false),
  query = ref(""),
  busy = ref(false),
  error = ref("");
const selected = ref<Resource[]>([]),
  candidates = ref<Resource[]>([]),
  tag = ref("");
let timer: ReturnType<typeof setTimeout> | undefined,
  sequence = 0;
async function refresh() {
  try {
    await store.refresh();
    error.value = "";
  } catch (e) {
    error.value = errorMessage(e);
  }
}
onMounted(refresh);
watch(() => route.path, refresh);
async function search() {
  const seq = ++sequence,
    group = kind.value;
  try {
    const page = await api<Page>(
      `/${group}?scope=mine&status=all&page_size=100&q=${encodeURIComponent(query.value)}`,
    );
    if (seq === sequence) candidates.value = page.items;
  } catch (e) {
    if (seq === sequence) error.value = errorMessage(e);
  }
}
watch(query, () => {
  clearTimeout(timer);
  timer = setTimeout(search, 600);
});
onUnmounted(() => {
  clearTimeout(timer);
  sequence++;
});
async function edit(group: Kind) {
  kind.value = group;
  busy.value = true;
  try {
    await store.refresh();
    selected.value = [...store.groups[group].items];
    tag.value = store.groups[group].etag;
    query.value = "";
    open.value = true;
    error.value = "";
    await search();
  } catch (e) {
    ElMessage.error(errorMessage(e));
  } finally {
    busy.value = false;
  }
}
function move(index: number, direction: number) {
  const items = [...selected.value];
  const other = index + direction;
  if (other < 0 || other >= items.length) return;
  [items[index], items[other]] = [items[other]!, items[index]!];
  selected.value = items;
}
async function save() {
  busy.value = true;
  try {
    await store.save(
      kind.value,
      selected.value.map((item) => item.id),
      tag.value,
    );
    open.value = false;
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <section
    v-for="group in ['projects', 'teams'] as const"
    :key="group"
    class="shortcut-group"
  >
    <div class="shortcut-heading">
      <span class="nav-text">{{ group === "projects" ? "项目" : "团队" }}</span
      ><button
        class="icon-btn shortcut-add"
        :disabled="busy"
        :aria-label="`管理${group === 'projects' ? '项目' : '团队'}快捷方式`"
        @click="edit(group)"
      >
        +
      </button>
    </div>
    <RouterLink
      v-for="item in store.groups[group].items"
      :key="item.id"
      class="nav-item"
      :class="{ active: route.path === `/${group}/${item.id}` }"
      :to="`/${group}/${item.id}`"
      :title="item.name"
      ><ResourceIcon
        :icon-key="item.icon_key"
        :file-id="item.icon_file_id"
      /><span class="nav-text shortcut-name">{{ item.name }}</span
      ><small v-if="item.status === 'archived'" class="nav-text"
        >归档</small
      ></RouterLink
    >
    <p v-if="!store.groups[group].items.length" class="nav-text shortcut-empty">
      暂无固定{{ group === "projects" ? "项目" : "团队" }}
    </p>
  </section>
  <button v-if="error && !open" class="nav-item" @click="refresh">
    加载失败，点击重试
  </button>
  <ElDialog
    v-model="open"
    :title="`管理${kind === 'projects' ? '项目' : '团队'}快捷方式`"
    width="560px"
    :close-on-click-modal="false"
    :close-on-press-escape="!busy"
    :show-close="!busy"
    append-to-body
  >
    <p>
      固定你参与的{{
        kind === "projects" ? "项目" : "团队"
      }}，使用上下按钮调整顺序。
    </p>
    <p v-if="error" role="alert" class="shortcut-error">{{ error }}</p>
    <div v-for="(item, index) in selected" :key="item.id" class="shortcut-row">
      <ResourceIcon
        :icon-key="item.icon_key"
        :file-id="item.icon_file_id"
      /><span>{{ item.name }}</span
      ><ElButton
        :disabled="busy || index === 0"
        :aria-label="`上移${item.name}`"
        @click="move(index, -1)"
        >↑</ElButton
      ><ElButton
        :disabled="busy || index === selected.length - 1"
        :aria-label="`下移${item.name}`"
        @click="move(index, 1)"
        >↓</ElButton
      ><ElButton :disabled="busy" @click="selected.splice(index, 1)"
        >取消固定</ElButton
      >
    </div>
    <ElInput
      v-model="query"
      placeholder="搜索我的项目或团队"
      clearable
      :disabled="busy"
    />
    <div class="shortcut-candidates">
      <div
        v-for="item in candidates.filter(
          (item) => !selected.some((v) => v.id === item.id),
        )"
        :key="item.id"
        class="shortcut-row"
      >
        <ResourceIcon
          :icon-key="item.icon_key"
          :file-id="item.icon_file_id"
        /><span
          >{{ item.name }} <small>{{ item.code }}</small></span
        ><ElButton
          :disabled="busy || selected.length >= 200"
          @click="selected.push(item)"
          >固定</ElButton
        >
      </div>
    </div>
    <template #footer
      ><ElButton :disabled="busy" @click="open = false">取消</ElButton
      ><ElButton type="primary" :loading="busy" @click="save"
        >保存</ElButton
      ></template
    >
  </ElDialog>
</template>
<style scoped>
.shortcut-group {
  margin-top: 22px;
}
.shortcut-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  color: var(--text-muted);
  min-height: 36px;
}
.shortcut-add {
  opacity: 0;
  font-size: 24px;
}
.shortcut-group:hover .shortcut-add,
.shortcut-group:focus-within .shortcut-add {
  opacity: 1;
}
.shortcut-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.shortcut-empty {
  padding: 0 12px;
  color: var(--text-muted);
  font-size: 12px;
}
.shortcut-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 12px 0;
}
.shortcut-row > span:nth-child(2) {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.shortcut-candidates {
  max-height: 260px;
  overflow: auto;
}
.shortcut-error {
  color: var(--danger);
}
:global(.sidebar-collapsed) .shortcut-heading {
  justify-content: center;
}
@media (hover: none) {
  .shortcut-add {
    opacity: 1;
  }
}
</style>
