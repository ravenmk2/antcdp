# 平台与身份

平台负责安装、登录会话、账号、设置和审计。具体角色、字段、默认值、接口及限制以服务实现和测试为准。

## 源码入口

- [身份与会话](../../../internal/modules/identity)
- [安装](../../../internal/modules/install)
- [系统设置](../../../internal/modules/settings)
- [审计](../../../internal/modules/audit)
- [HTTP 装配](../../../internal/server/identity.go)
- [前端访问流程](../../../web/src/features/access)

## 关键边界

- 服务端逐次授权；前端可见性不能替代权限校验。
- 身份变更、凭据和会话失效、相关审计需保持事务一致性。敏感信息不进入普通响应与日志。
- 安装身份、数据库和本地密钥必须一致。恢复操作不能把异常安装当作空环境覆盖。

## 验证

从所属模块的单元测试、[HTTP 测试](../../../internal/server/)和[MySQL 集成测试](../../../internal/store/mysql/)选择受影响用例。运行方法及真实外部服务的验证边界见[测试与验证](../../development/testing.md)。
