# 项目与团队

协作领域拥有项目、团队、成员关系、资源图标和账号快捷方式。仓库关联归项目交付模块。

## 源码入口

- [领域规则](../../../internal/modules/collaboration)
- [HTTP 装配](../../../internal/server/collaboration.go)
- [媒体处理](../../../internal/modules/media)
- [前端功能](../../../web/src/features/collaboration)

## 关键边界

- 系统管理权限与项目、团队内的业务角色分别校验。权限不能由名称、路由或客户端缓存推断。
- 成员关系、生命周期、媒体绑定及其审计在用例事务中共同验证。跨领域参与事务使用小范围端口。
- 上传暂存与正式绑定分开；只有引用确认结束后才回收文件。

## 验证

从所属模块的单元测试、[HTTP 测试](../../../internal/server/)和[MySQL 集成测试](../../../internal/store/mysql/)选择受影响用例。运行方法及真实外部服务的验证边界见[测试与验证](../../development/testing.md)。
