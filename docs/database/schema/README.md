# 数据库结构脚本

本目录按业务范围提供 DDL 阅读副本。实际安装与升级执行[嵌入式 Goose 迁移](../../../internal/store/migrations/mysql/)；不要将本目录脚本导入现有安装，也不要将文件顺序视为升级顺序。

结构以[嵌入式迁移](../../../internal/store/migrations/mysql/)为准，本目录的领域分组不对应迁移版本。必需模块种子保留在迁移中，不写入结构阅读副本。

## 领域分组

| 脚本 | 范围 | 契约入口 |
| --- | --- | --- |
| [platform.sql](platform.sql) | 用户、凭据、会话、设置、安装与审计 | [平台存储](../../domains/platform/identity.md) |
| [collaboration.sql](collaboration.sql) | 项目、团队、成员、图标及快捷方式 | [协作契约](../../domains/collaboration/overview.md) |
| [delivery.sql](delivery.sql) | 仓库关联、项目内标签及标签绑定 | [项目仓库](../../domains/delivery/repositories.md) |
| [integrations.sql](integrations.sql) | 服务连接、凭证、Webhook 与 SSH 主机 | [服务集成](../../domains/integrations/overview.md)、[远程主机](../../domains/remote-hosts/overview.md) |
| [messaging.sql](messaging.sql) | 邮件、短信与钉钉 | [消息管理](../../domains/messaging/overview.md) |
| [ai.sql](ai.sql) | 模型、网络检索、智能体、技能、MCP、运行及成果 | [AI 存储与事务](../../domains/agents/overview.md) |
| [sandboxes.sql](sandboxes.sql) | 单一沙箱连接、云电脑模板、电脑、租约、执行和技能物化 | [云电脑](../../domains/sandboxes/overview.md) |

分文件只用于阅读，不改变模块依赖或事务边界。跨领域资源引用只定义一次；字段类型、可空性、生成列、默认值和索引须与迁移保持一致。SQL 不包含种子、升级数据修正或秘密；MySQL DDL 隐式提交，不能作为整批操作可回滚的承诺。

后端结构变更时，在同一开发任务中同步更新对应阅读副本，反映全部迁移执行后的结构。副本通过开发审核维护，CI 和检查脚本不校验其内容或一致性；实际安装与迁移行为通过 MySQL 集成测试验证。测试方法见[测试与验证](../../development/testing.md)，通用存储和迁移规则见[数据库约定](../README.md)。
