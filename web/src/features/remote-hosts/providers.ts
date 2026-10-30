import { markRaw, type Component } from "vue";
import SSHConnectionSettings from "./SSHConnectionSettings.vue";

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
function sshUI(method = "ssh_password"): ServiceUI {
 const key = method === "ssh_private_key" || method === "ssh_encrypted_key";
 return { settings: markRaw(SSHConnectionSettings), authMethod: key ? method : "ssh_password", authLabel: key ? "SSH 私钥" : "密码",
 connectionFields: [{key:"host",label:"主机名 / IP",limit:253},{key:"port",label:"SSH 端口",limit:5}],
 identityFields:[{key:"username",label:"登录用户名",limit:255}],
 secretFields: key ? [{key:"private_key",label:"SSH 私钥",type:"textarea",limit:32768}, ...(method === "ssh_encrypted_key" ? [{key:"passphrase",label:"私钥口令",type:"password" as const,limit:8192}] : [])] : [{key:"token",label:"密码",type:"password",limit:8192}],
 connectionBody:v=>({host:v.host??"",port:Number(v.port??22)}), identityBody:v=>({username:v.username??""}),
 secretBody:v=>key?{private_key:v.private_key??"",...(method==="ssh_encrypted_key"?{passphrase:v.passphrase??""}:{})}:{token:v.token??""},
 validateSecret:v=>!v.username?.trim()?"请输入登录用户名":key?(!v.private_key?"请输入 SSH 私钥":method==="ssh_encrypted_key"&&!v.passphrase?"请输入私钥口令":""):!v.token?"请输入密码":"" };
}
export const serviceUI: Record<string, ServiceUI> = {ssh:sshUI()};
export function authenticationUI(_kind:string,method?:string):ServiceUI{return sshUI(method)}
