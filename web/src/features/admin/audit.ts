export interface AuditEvent {
  id: string;
  actor: {
    type: string;
    user_id: string | null;
    username: string | null;
    display_name: string;
  };
  action: string;
  target: { type: string; id: string | null; label: string };
  occurred_at: string;
  request_id: string | null;
  ip_address: string | null;
  detail: Record<string, unknown>;
}
export const actionLabels: Record<string, string> = {
  "remote_host.verified": "测试远程主机",
 "ssh_credential.verified": "验证 SSH 凭证",
 "remote_host.created": "创建远程主机",
  "remote_host.updated": "更新远程主机",
  "remote_host.deleted": "删除远程主机",
  "remote_host.fallback_changed": "修改兜底凭证",
  "ssh_credential.created": "创建SSH 凭证",
  "ssh_credential.updated": "更新SSH 凭证",
  "ssh_credential.deleted": "删除SSH 凭证",
  "ssh_credential.authentication_replaced": "替换认证信息",
  "ssh_credential.preferred_changed": "修改首选凭证",
  "service_connection.created": "创建服务连接",
  "service_connection.updated": "更新服务连接",
  "service_connection.deleted": "删除服务连接",
  "service_connection.fallback_changed": "修改兜底凭证",
  "service_credential.created": "创建访问凭证",
  "service_credential.updated": "更新访问凭证",
  "service_credential.deleted": "删除访问凭证",
  "service_credential.authentication_replaced": "替换认证信息",
  "service_credential.preferred_changed": "修改首选凭证",
  "service_connection.webhook_updated": "更新 Webhook 接收设置",
    "service_connection.webhook_verification_replaced": "替换 Webhook 验证秘密",
    "webhook_endpoint.created": "创建 Webhook 接入点",
  "webhook_endpoint.updated": "更新 Webhook 接入点",
  "webhook_endpoint.deleted": "删除 Webhook 接入点",
  "webhook_endpoint.verification_replaced": "替换接入点验证秘密",
  "integration.created": "创建服务集成",
  "integration.update": "更新服务集成",
  "integration.deleted": "删除服务集成",
  "integration.set_default": "设置默认凭证",
  "integration.clear_default": "清除默认凭证",
  "integration.update_config": "更新服务配置",
  "integration.webhook_secret": "替换 Webhook 秘密",
  "integration.generate_webhook": "生成 Webhook 秘密",
  "integration.credential.create": "创建集成凭证",
  "integration.credential.update": "更新集成凭证",
  "integration.credential.secret": "替换集成凭证秘密",
  "integration.credential.delete": "删除集成凭证",
  "integration.credential.preferred": "设置首选凭证",
  "integration.credential.clear_preferred": "取消首选凭证",

  "project.created": "创建项目",
  "project.updated": "更新项目资料",
  "project.archived": "归档项目",
  "project.restored": "恢复项目",
  "team.created": "创建团队",
  "team.updated": "更新团队资料",
  "team.dissolved": "解散团队",
  "project.member_added": "添加项目成员",
  "project.member_removed": "移除项目成员",
  "project.member_role_changed": "调整项目成员角色",
  "project.member_left": "退出项目",
  "team.member_added": "添加团队成员",
  "team.member_removed": "移除团队成员",
  "team.member_role_changed": "调整团队成员角色",
  "team.member_left": "退出团队",
  "project.team_added": "添加项目团队",
  "project.team_removed": "移除项目团队",
  "installation.completed": "完成系统安装",
  "auth.login_succeeded": "登录系统",
  "auth.logged_out": "退出登录",
  "user.created": "创建用户",
  "user.registered": "自主注册",
  "user.profile_updated": "更新用户资料",
  "user.avatar_changed": "更新用户头像",
  "user.password_changed": "修改密码",
  "user.password_reset": "重置密码",
  "user.password_recovered": "恢复账号密码",
  "user.role_changed": "调整用户角色",
  "user.disabled": "禁用用户",
  "user.enabled": "启用用户",
  "user.deleted": "删除用户",
  "settings.updated": "更新系统设置",
};
export function actionIcon(action: string) {
  if (action.includes("password") || action.startsWith("auth."))
    return "key" as const;
  if (action.startsWith("settings.")) return "settings" as const;
  if (action.startsWith("installation.")) return "database" as const;
  if (action.startsWith("user.")) return "user" as const;
  return "log" as const;
}
