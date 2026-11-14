import type { ProviderDefinition } from "./service-providers";
export const sshProvider: ProviderDefinition = {
  type: "ssh",
  name: "SSH",
  description: "远程主机登录凭证",
  configFields: [
    { key: "host", label: "主机名 / IP" },
    { key: "port", label: "SSH 端口" },
  ],
  methods: [
    {
      value: "ssh_password",
      label: "密码",
      identity: [{ key: "username", label: "登录用户名" }],
      secret: [{ key: "token", label: "密码", type: "password" }],
    },
    {
      value: "ssh_private_key",
      label: "未加密私钥",
      identity: [{ key: "username", label: "登录用户名" }],
      secret: [{ key: "private_key", label: "SSH 私钥", type: "textarea" }],
    },
    {
      value: "ssh_encrypted_key",
      label: "加密私钥",
      identity: [{ key: "username", label: "登录用户名" }],
      secret: [
        { key: "private_key", label: "SSH 私钥", type: "textarea" },
        { key: "passphrase", label: "私钥口令", type: "password" },
      ],
    },
  ],
  configBody: (values) => ({
    host: values.host ?? "",
    port: Number(values.port ?? 22),
  }),
};
