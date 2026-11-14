# 搜索与网页读取

网络检索是可独立使用的基础能力。它管理提供商、路由、受控读取和诊断；具体能力、限额及默认参数由注册代码提供。

## 源码入口

- [业务与适配器](../../../internal/modules/webaccess)
- [HTTP 装配](../../../internal/server/web_access.go)
- [持久化与诊断](../../../internal/store/mysql/web_access.go)
- [前端功能](../../../web/src/areas/console/pages/web-access)

## 关键边界

- 调用方负责自身授权。公开检索和内网读取的目标策略不能相互绕过。
- 内置读取逐跳验证目标；交由第三方读取时不能宣称平台已验证其每次重定向和实际连接。
- 返回内容属于不可信外部数据。取消、策略拒绝和未知远端结果不能触发不受控的重试或路由切换。

## 验证

从所属模块的单元测试、[HTTP 测试](../../../internal/server/)和[MySQL 集成测试](../../../internal/store/mysql/)选择受影响用例。运行方法及真实外部服务的验证边界见[测试与验证](../../development/testing.md)。
