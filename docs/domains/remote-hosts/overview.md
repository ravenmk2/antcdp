# 远程主机

远程主机模块管理 SSH 连接资料、主机信任、凭证及诊断，不作为服务集成类型实现。功能范围以该模块的注册接口为准。

## 源码入口

- [领域规则](../../../internal/modules/remotehosts)
- [HTTP 装配](../../../internal/server/remote_hosts.go)
- [前端功能](../../../web/src/features/remote-hosts)

## 关键边界

- 主机公钥与用户登录秘密分开管理。探测到公钥不等于已信任，认证前必须验证主机身份。
- 凭证加密绑定用途和所属资源；诊断与审计不能返回原始秘密。
- 地址、信任和凭证变化必须参与版本验证，旧诊断不能被当作当前配置的认证依据。

## 验证

从所属模块的单元测试、[HTTP 测试](../../../internal/server/)和[MySQL 集成测试](../../../internal/store/mysql/)选择受影响用例。运行方法及真实外部服务的验证边界见[测试与验证](../../development/testing.md)。
