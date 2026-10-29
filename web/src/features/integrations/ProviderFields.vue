<script setup lang="ts">
import { ElInput, ElSelect, ElOption } from "element-plus";
import type { ProviderField } from "./providers";
const values = defineModel<Record<string, string>>({ required: true });
defineProps<{ fields: ProviderField[]; disabled?: boolean; showHelp?: boolean }>();
</script>
<template>
  <label v-for="field in fields" :key="field.key"
    >{{ field.label }}
    <ElSelect
      v-if="field.options"
      v-model="values[field.key]"
      :disabled="disabled"
      ><ElOption
        v-for="option in field.options"
        :key="option.value"
        :label="option.label"
        :value="option.value"
    /></ElSelect>
    <ElInput
      v-else
      v-model="values[field.key]"
      :type="field.type ?? 'text'"
      :show-password="field.type === 'password'"
      :autocomplete="field.type === 'password' ? 'new-password' : 'off'"
      :maxlength="field.limit"
      :placeholder="showHelp === false ? undefined : field.placeholder"
      :rows="3"
      :disabled="disabled"
    />
    <small v-if="field.help && showHelp !== false">{{ field.help }}</small>
  </label>
</template>
