import { markRaw, type Component } from "vue";
import GitLabSettings from "./GitLabSettings.vue";
export interface ProviderField {
  key: string;
  label: string;
  type?: "text" | "textarea" | "password";
  limit?: number;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
}
export interface ServiceUI {
  settings: Component;
  authMethod: string;
  authLabel: string;
  connectionFields: ProviderField[];
  identityFields: ProviderField[];
  secretFields: ProviderField[];
  connectionBody(values: Record<string, string>): Record<string, unknown>;
  identityBody(values: Record<string, string>): Record<string, unknown>;
  secretBody(values: Record<string, string>): Record<string, unknown>;
  validateSecret(values: Record<string, string>): string;
}
// Register only implemented UI adapters. Backend capabilities further restrict availability.
export const serviceUI: Record<string, ServiceUI> = {
  gitlab: {
    settings: markRaw(GitLabSettings),
    authMethod: "gitlab_access_token",
    authLabel: "GitLab Access Token",
    connectionFields: [
      {
        key: "base_url",
        label: "GitLab 实例地址",
        placeholder: "https://gitlab.example.com",
        limit: 2048,
      },
      {
        key: "custom_ca_pem",
        label: "自定义 CA（可选）",
        type: "textarea",
        limit: 16384,
      },
    ],
    identityFields: [],
    secretFields: [
      {
        key: "token",
        label: "API Token",
        type: "password",
        limit: 8192,
        help: "保存后无法查看。替换保留首选和兜底设置。",
      },
    ],
    connectionBody: (v) => ({
      base_url: v.base_url ?? "",
      custom_ca_pem: v.custom_ca_pem || null,
    }),
    identityBody: () => ({}),
    secretBody: (v) => ({ token: v.token ?? "" }),
    validateSecret: (v) => (v.token ? "" : "请输入 API Token"),
  },
};
