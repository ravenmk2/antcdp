# 项目仓库

项目交付模块管理项目与远端仓库的关联、快照及标签。服务连接和凭证由服务集成模块提供。

## 源码入口

- [仓库业务规则](../../../internal/modules/integrations/repositories.go)与[仓库标签](../../../internal/modules/integrations/repository_labels.go)
- [HTTP 装配](../../../internal/server/project_repositories.go)
- [集成适配器](../../../internal/modules/integrations)

## 关键边界

- 远端快照不是实时状态；外部标识、地址和内容均按不可信输入处理。
- 网络请求在数据库事务之外执行；提交结果前重新检查权限、项目状态和相关版本。
- 成员读取不应泄露管理凭证。外发结果未知时不能自动重放写操作。

## 验证

从所属模块的单元测试、[HTTP 测试](../../../internal/server/)和[MySQL 集成测试](../../../internal/store/mysql/)选择受影响用例。运行方法及真实外部服务的验证边界见[测试与验证](../../development/testing.md)。
