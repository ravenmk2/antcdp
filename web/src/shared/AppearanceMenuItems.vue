<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { ElDropdown, ElDropdownItem, ElDropdownMenu, type DropdownInstance } from "element-plus";
import { useAppearance, type Appearance } from "./appearance";
import UiIcon from "./UiIcon.vue";

const emit = defineEmits<{ select: [value: Appearance] }>();
const { preference } = useAppearance();
const dropdown = ref<DropdownInstance>();
const trigger = ref<HTMLElement>();
const reference = ref<HTMLElement>();
const expanded = ref(false);
let keyboardOpen = false;
const options: { value: Appearance; label: string; icon: "sun" | "moon" | "device" }[] = [
  { value: "light", label: "浅色", icon: "sun" },
  { value: "dark", label: "深色", icon: "moon" },
  { value: "system", label: "跟随系统", icon: "device" },
];
const current = computed(() => options.find(option => option.value === preference.value)!);
onMounted(() => {
  reference.value = trigger.value?.closest<HTMLElement>('[role="menuitem"]') ?? undefined;
});

function select(command: string | number | object) {
  if (command === "light" || command === "dark" || command === "system") emit("select", command);
}
function triggerKeydown(event: KeyboardEvent) {
  if (!["ArrowRight", "Enter", " "].includes(event.key)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  keyboardOpen = true;
  dropdown.value?.handleOpen();
}
async function visibleChange(visible: boolean) {
  expanded.value = visible;
  if (visible && keyboardOpen) {
    await nextTick();
    dropdown.value?.contentRef?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }
  keyboardOpen = false;
}
async function submenuKeydown(event: KeyboardEvent) {
  if (event.key !== "ArrowLeft" && event.key !== "Escape") return;
  event.preventDefault();
  event.stopImmediatePropagation();
  dropdown.value?.handleClose();
  await nextTick();
  reference.value?.focus();
}
</script>

<template>
  <ElDropdownItem
    divided
    class="account-appearance-trigger"
    :aria-label="`外观：${current.label}`"
    aria-haspopup="menu"
    :aria-expanded="expanded"
    @click.prevent="dropdown?.handleOpen()"
    @keydown="triggerKeydown"
  >
    <ElDropdown
      ref="dropdown"
      trigger="hover"
      :tabindex="-1"
      placement="right-start"
      :show-timeout="100"
      :hide-timeout="300"
      :popper-options="{
        modifiers: [
          { name: 'flip', options: { fallbackPlacements: ['left-start', 'bottom-end', 'top-end'] } },
          { name: 'preventOverflow', options: { padding: 8 } },
        ],
      }"
      popper-class="account-dropdown appearance-submenu"
      @command="select"
      @visible-change="visibleChange"
    >
      <span ref="trigger" class="appearance-submenu-trigger" @focus="reference?.focus()">
        <UiIcon :name="current.icon" />
        <span>外观</span>
        <span class="account-appearance-current">{{ current.label }}</span>
        <UiIcon name="chevron" />
      </span>
      <template #dropdown>
        <ElDropdownMenu>
          <ElDropdownItem
            v-for="option in options"
            :key="option.value"
            :command="option.value"
            :aria-label="`${option.label}${preference === option.value ? '（当前外观）' : '外观'}`"
            :aria-current="preference === option.value ? 'true' : undefined"
            class="account-appearance-item"
            :class="{ 'is-selected': preference === option.value }"
            @keydown="submenuKeydown"
          >
            <UiIcon :name="option.icon" />
            <span>{{ option.label }}</span>
            <UiIcon v-if="preference === option.value" name="check" class="account-appearance-check" />
          </ElDropdownItem>
        </ElDropdownMenu>
      </template>
    </ElDropdown>
  </ElDropdownItem>
</template>
