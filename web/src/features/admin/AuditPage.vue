<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, reactive, ref, watch } from "vue";
import { ElButton, ElDatePicker } from "element-plus";
import { useListSearch } from "../../shared/listSearch";
import AppLayout from "../../app/AppLayout.vue";
import UiIcon from "../../shared/UiIcon.vue";
import PageSizeSelect from "../../shared/PageSizeSelect.vue";
import { usePageSize } from "../../shared/pageSize";
import RefreshButton from "../../shared/RefreshButton.vue";
import { request } from "../../shared/api";
import { errorMessage, useIdentity } from "../identity/store";
import AuditDetail from "./AuditDetail.vue";
import { actionLabels, actionIcon, type AuditEvent } from "./audit";
import "./audit.css";
const identity = useIdentity();
const pageSize = usePageSize("audit");
watch(pageSize, () => listSearch.run());
const filters = reactive({ q: "", action: "" });
const dates = ref<[Date, Date] | null>(null);
const events = ref<AuditEvent[]>([]),
  loading = ref(true),
  error = ref("");
const cursors = ref<(string | undefined)[]>([undefined]);
const page = ref(0),
  next = ref<string | null>(null);
const detailOpen = ref(false),
  selected = ref<string>();
let sequence = 0;
async function load() {
  const current = ++sequence;
  loading.value = true;
  error.value = "";
  if (dates.value && dates.value[0].getTime() >= dates.value[1].getTime()) {
    error.value = "结束时间必须晚于开始时间。";
    events.value = [];
    next.value = null;
    loading.value = false;
    return;
  }
  const params = new URLSearchParams({ limit: String(pageSize.value) });
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.action) params.set("action_prefix", filters.action);
  if (cursors.value[page.value])
    params.set("cursor", cursors.value[page.value]!);
  if (dates.value) {
    params.set("from", dates.value[0].toISOString());
    params.set("to", dates.value[1].toISOString());
  }
  try {
    const response = await request<AuditEvent[]>(
      `/admin/audit-events?${params}`,
    );
    if (current !== sequence) return;
    events.value = response.data;
    next.value = response.pagination?.next_cursor || null;
  } catch (err) {
    if (current === sequence) {
      error.value = errorMessage(err);
      events.value = [];
      next.value = null;
    }
  } finally {
    if (current === sequence) loading.value = false;
  }
}
function search() {
  page.value = 0;
  cursors.value = [undefined];
  void load();
}
function changePage(delta: number) {
  if (loading.value) return;
  if (delta > 0 && next.value) {
    cursors.value[page.value + 1] = next.value;
    page.value++;
  } else if (delta < 0 && page.value > 0) page.value--;
  else return;
  void load();
}
function showDetail(id: string) {
  selected.value = id;
  detailOpen.value = true;
}
const listSearch = useListSearch(search, () => { sequence++; loading.value = true; });
const hasFilters = computed(() => Boolean(filters.q || filters.action || dates.value));
function clearFilters() {
  filters.q = "";
  filters.action = "";
  dates.value = null;
  listSearch.run();
}
onMounted(load);
onBeforeUnmount(() => {
  sequence++;
});
</script>
<template>
  <AppLayout>
    <div v-if="error" class="error-banner" role="alert">{{ error }}</div>
    <section class="panel" aria-label="审计日志列表" :aria-busy="loading">
      <div class="table-toolbar audit-toolbar">
        <label class="search-box"
          ><UiIcon name="search" /><input
            v-model="filters.q"
            name="audit-search"
            autocomplete="off"
            aria-label="搜索审计记录"
            placeholder="搜索操作者、操作对象或事件…"
            maxlength="64"
            @input="listSearch.input"
            @compositionstart="listSearch.compositionStart"
            @compositionend="listSearch.compositionEnd"
            @keydown.enter="listSearch.enter" /></label
        ><select
          v-model="filters.action"
          class="select-filter"
          aria-label="筛选事件类型"
          @change="listSearch.run"
        >
          <option value="">全部事件</option>
          <option value="user.">用户操作（含注册）</option>
          <option value="settings.">系统设置</option>
          <option value="auth.">登录与退出</option>
          <option value="installation.">系统安装</option></select
        >
        <div class="audit-time-filter">
          <span>时间范围</span
          ><ElDatePicker
            v-model="dates"
            type="datetimerange"
            start-placeholder="开始时间"
            end-placeholder="结束时间"
            range-separator="至"
            :editable="false"
            :clearable="true"
            @change="listSearch.run"
          />
        </div>
        <ElButton :disabled="!hasFilters" @click="clearFilters">清除筛选</ElButton>
        <RefreshButton :loading="loading" @click="listSearch.run">刷新</RefreshButton>
      </div>
      <div v-if="events.length" class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>事件</th>
              <th>操作者</th>
              <th>操作对象</th>
              <th>时间</th>
              <th>结果</th>
              <th class="audit-detail-column"><span class="sr-only">详情</span></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="event in events"
              :key="event.id"
              class="audit-row"
              @click="showDetail(event.id)"
            >
              <td>
                <div class="audit-event">
                  <span class="event-icon"
                    ><UiIcon :name="actionIcon(event.action)" /></span
                  ><button
                    type="button"
                    class="audit-event-link"
                    @click.stop="showDetail(event.id)"
                  >
                    {{ actionLabels[event.action] || event.action }}
                  </button>
                </div>
              </td>
              <td>{{ event.actor.display_name }}</td>
              <td class="audit-target">{{ event.target.label }}</td>
              <td class="mono">{{ identity.date(event.occurred_at) }}</td>
              <td><span class="audit-result">成功</span></td>
              <td><UiIcon name="chevron" /></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else-if="error && !loading" class="empty" role="status">
        <h3>审计记录加载失败</h3>
        <p>未能获取数据，请重试。</p>
        <button class="btn" @click="load">重试</button>
      </div>
      <div v-else class="empty" role="status">
        <UiIcon name="log" />
        <h3>{{ loading ? "正在加载审计记录" : "暂无匹配的审计记录" }}</h3>
        <p v-if="!loading">试试其他事件类型、时间范围或关键词。</p>
      </div>
      <div v-if="!error" class="table-footer">
        <div class="list-page-summary">
          <span>本页 {{ events.length }} 条记录</span>
          <PageSizeSelect v-model="pageSize" :disabled="loading" />
        </div>
        <div class="pagination">
          <button
            type="button"
            class="page-button"
            :disabled="loading || page === 0"
            aria-label="上一页"
            @click="changePage(-1)"
          >
            <UiIcon name="back" /></button
          ><span>第 {{ page + 1 }} 页</span
          ><button
            type="button"
            class="page-button"
            :disabled="loading || !next"
            aria-label="下一页"
            @click="changePage(1)"
          >
            <UiIcon name="chevron" />
          </button>
        </div>
      </div>
    </section>
    <AuditDetail v-model="detailOpen" :id="selected" />
  </AppLayout>
</template>
