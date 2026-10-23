<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  ElDropdown,
  ElDropdownMenu,
  ElDropdownItem,
  type DropdownInstance,
} from "element-plus";
import UiIcon from "../shared/UiIcon.vue";
import BrandLogo from "../shared/BrandLogo.vue";
import UserAvatar from "../shared/UserAvatar.vue";
import AppearanceMenuItems from "../shared/AppearanceMenuItems.vue";
import { useAppearance } from "../shared/appearance";
import {
  useIdentity,
} from "../features/identity/store";
import { useLogout } from "../features/identity/logout";
const identity = useIdentity();
const { logout, loggingOut } = useLogout();
const { setAppearance } = useAppearance();
const desktopAccountMenu = ref<DropdownInstance>();
const mobileAccountMenu = ref<DropdownInstance>();
const route = useRoute();
const router = useRouter();
const consoleMode = computed(() => route.path.startsWith("/admin"));
function storedCollapsed() {
  try {
    return localStorage.getItem("antcdp.sidebar-collapsed") === "true";
  } catch {
    return false;
  }
}
const collapsed = ref(storedCollapsed());
const mobileOpen = ref(false);
watch(collapsed, (value) => {
  try {
    localStorage.setItem("antcdp.sidebar-collapsed", String(value));
  } catch {
    // Navigation remains usable when browser preferences cannot be stored.
  }
});
watch(
  () => route.path,
  () => {
    mobileOpen.value = false;
  },
);
async function userCommand(command: string | number | object) {
  if (command === "light" || command === "dark" || command === "system") {
    setAppearance(command);
    desktopAccountMenu.value?.handleClose();
    mobileAccountMenu.value?.handleClose();
  } else if (command === "logout") {
    await logout();
  } else if (typeof command === "string") void router.push(command);
}
</script>
<template>
  <div class="app-shell" :class="{ 'sidebar-collapsed': collapsed }">
    <button
      v-if="mobileOpen"
      class="mobile-scrim show"
      aria-label="关闭导航"
      @click="mobileOpen = false"
    />
    <aside
      class="sidebar"
      :class="{ 'mobile-open': mobileOpen }"
      aria-label="侧边栏"
    >
      <div class="sidebar-heading">
        <BrandLogo />
        <div class="brand-sub">AI NATIVE COLLABORATION</div>
      </div>
      <nav
        class="sidebar-main"
        :aria-label="consoleMode ? '控制台导航' : '主导航'"
      >
        <template v-if="consoleMode">
          <div class="nav-label">控制台</div>
          <RouterLink
            class="nav-item"
            title="概览"
            aria-label="概览"
            to="/admin"
            :class="{ active: route.path === '/admin' }"
            ><UiIcon name="dashboard" /><span class="nav-text"
              >概览</span
            ></RouterLink
          >
          <RouterLink
            class="nav-item"
            title="用户管理"
            aria-label="用户管理"
            to="/admin/users"
            :class="{ active: route.path === '/admin/users' }"
            ><UiIcon name="users" /><span class="nav-text"
              >用户管理</span
            ></RouterLink
          >
          <RouterLink
            class="nav-item"
            title="系统设置"
            aria-label="系统设置"
            to="/admin/settings"
            :class="{ active: route.path === '/admin/settings' }"
            ><UiIcon name="settings" /><span class="nav-text"
              >系统设置</span
            ></RouterLink
          >
          <RouterLink
            class="nav-item"
            title="审计日志"
            aria-label="审计日志"
            to="/admin/audit"
            :class="{ active: route.path === '/admin/audit' }"
            ><UiIcon name="log" /><span class="nav-text"
              >审计日志</span
            ></RouterLink
          >
        </template>
        <template v-else>
          <RouterLink
            class="nav-item"
            title="首页"
            aria-label="首页"
            to="/home"
            :class="{ active: route.path === '/home' }"
            ><UiIcon name="home" /><span class="nav-text"
              >首页</span
            ></RouterLink
          >
          <RouterLink
            class="nav-item"
            title="个人设置"
            aria-label="个人设置"
            to="/account"
            :class="{ active: route.path.startsWith('/account') }"
            ><UiIcon name="user" /><span class="nav-text"
              >个人设置</span
            ></RouterLink
          >
        </template>
      </nav>
      <div v-if="identity.user" class="sidebar-bottom">
        <ElDropdown
          ref="desktopAccountMenu"
          :persistent="false"
          class="sidebar-account-dropdown"
          trigger="click"
          placement="top-start"
          popper-class="account-dropdown"
          @command="userCommand"
        >
          <button
            class="user-chip sidebar-account"
            :aria-label="`账号菜单：${identity.user.display_name}`"
            :title="`${identity.user.display_name} · 账号菜单`"
          >
            <UserAvatar :user="identity.user" /><span class="account-text"
              ><span class="account-name">{{ identity.user.display_name }}</span
              ><span class="account-username"
                >@{{ identity.user.username }}</span
              ></span
            >
            <UiIcon name="more" class="account-more" />
          </button>
          <template #dropdown
            ><ElDropdownMenu>
              <div class="account-menu-header">
                <UserAvatar :user="identity.user" />
                <div>
                  <strong>{{ identity.user.display_name }}</strong
                  ><span>@{{ identity.user.username }}</span>
                </div>
              </div>
              <ElDropdownItem command="/account"
                ><UiIcon name="user" />个人设置</ElDropdownItem
              >
              <ElDropdownItem
                v-if="
                  identity.isAdmin && !identity.session?.require_password_change
                "
                command="/admin"
                ><UiIcon name="shield" />控制台</ElDropdownItem
              >
              <AppearanceMenuItems @select="userCommand" />
              <ElDropdownItem command="logout" divided :disabled="loggingOut"
                ><UiIcon name="logout" />退出登录</ElDropdownItem
              >
            </ElDropdownMenu></template
          >
        </ElDropdown>
      </div>
    </aside>
    <div class="main-shell">
      <header class="topbar">
        <div class="topbar-leading">
          <button
            class="icon-btn sidebar-toggle"
            :aria-label="collapsed ? '展开侧栏' : '收起侧栏'"
            @click="collapsed = !collapsed"
          >
            <UiIcon :name="collapsed ? 'expand' : 'panel'" />
          </button>
          <button
            class="icon-btn mobile-menu"
            aria-label="展开导航"
            :aria-expanded="mobileOpen"
            @click="mobileOpen = !mobileOpen"
          >
            <UiIcon name="menu" />
          </button>
          <nav class="breadcrumb" aria-label="当前位置">
            <RouterLink :to="consoleMode ? '/admin' : '/home'">{{
              consoleMode ? "控制台" : "首页"
            }}</RouterLink
            ><template v-if="route.path !== '/home'"
              ><UiIcon name="chevron" /><span
                class="current"
                aria-current="page"
                >{{ route.meta.title }}</span
              ></template
            >
          </nav>
        </div>
        <div class="topbar-right">
          <nav v-if="consoleMode" class="area-navigation" aria-label="返回导航">
            <RouterLink to="/home"><UiIcon name="back" />返回工作区</RouterLink>
          </nav>
          <ElDropdown
            ref="mobileAccountMenu"
            :persistent="false"
            v-if="identity.user"
            class="mobile-account"
            trigger="click"
            popper-class="account-dropdown"
            @command="userCommand"
          >
            <button class="user-chip" aria-label="打开账号菜单">
              <UserAvatar :user="identity.user" />
            </button>
            <template #dropdown>
              <ElDropdownMenu>
                <ElDropdownItem command="/account">
                  <UiIcon name="user" />个人设置
                </ElDropdownItem>
                <ElDropdownItem
                  v-if="
                    identity.isAdmin &&
                    !identity.session?.require_password_change
                  "
                  command="/admin"
                >
                  <UiIcon name="shield" />控制台
                </ElDropdownItem>
                <AppearanceMenuItems @select="userCommand" />
                <ElDropdownItem command="logout" divided :disabled="loggingOut">
                  <UiIcon name="logout" />退出登录
                </ElDropdownItem>
              </ElDropdownMenu>
            </template>
          </ElDropdown>
        </div>
      </header>
      <main class="content">
        <slot />
        <footer class="page-footer">
          <span>© 2026 AntCDP · AI 原生团队协作开发平台</span
          ><span class="flex"
            ><UiIcon name="shield" />让协作有序，让开发专注</span
          >
        </footer>
      </main>
    </div>
  </div>
</template>
