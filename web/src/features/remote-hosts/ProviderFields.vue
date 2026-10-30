<script setup lang="ts">
import { ElInput, ElSelect, ElOption, ElMessage } from "element-plus";
import type { ProviderField } from "./providers";
const values = defineModel<Record<string, string>>({ required: true });
defineProps<{ fields: ProviderField[]; disabled?: boolean; showHelp?: boolean }>();
async function importKey(event: Event) { const input=event.target as HTMLInputElement; const file=input.files?.[0]; if(!file)return; if(file.size>32768){ElMessage.error("私钥文件不能超过 32 KiB"); input.value="";return;} try {values.value={...values.value,private_key:await file.text()};} catch {ElMessage.error("读取文件失败");} input.value=""; }
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
    <input v-if="field.key === 'private_key'" type="file" aria-label="导入 SSH 私钥" :disabled="disabled" @change="importKey" />
    <small v-if="field.help && showHelp !== false">{{ field.help }}</small>
  </label>
</template>
