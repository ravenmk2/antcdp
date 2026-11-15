# 数据库结构脚本

本目录按业务范围提供 DDL 阅读副本。实际安装与升级执行[嵌入式 Goose 迁移](../../../internal/store/migrations/mysql/)；不要将本目录脚本导入现有安装，也不要将文件顺序视为升级顺序。

结构以[嵌入式迁移](../../../internal/store/migrations/mysql/)为准，本目录的领域分组不对应迁移版本。必需模块种子保留在迁移中，不写入结构阅读副本。

## 领域分组

| 脚本 | 范围 |
| --- | --- |
| [platform.sql](platform.sql) | 用户、凭据、会话、设置、安装与审计 |
| [collaboration.sql](collaboration.sql) | 项目、团队、成员、图标及快捷方式 |
| [delivery.sql](delivery.sql) | 仓库关联、项目内标签及标签绑定 |
| [integrations.sql](integrations.sql) | 服务连接、凭证与入站验证配置 |
| [remote_hosts.sql](remote_hosts.sql) | SSH 主机、公钥信任与凭证 |
| [messaging.sql](messaging.sql) | 邮件、短信与钉钉 |
| [models.sql](models.sql) | 模型提供商与模型定义 |
| [web_access.sql](web_access.sql) | 检索提供商与搜索、读取设置 |
| [agents.sql](agents.sql) | 智能体、技能、MCP、会话、运行、文件、成果、图像缓存及沙箱调用关联 |
| [sandboxes.sql](sandboxes.sql) | 基础连接、实例、租约、物理执行及操作 |
| [cloud-computers.sql](cloud-computers.sql) | 云电脑模板、持久工作空间及产品操作 |

按业务领域分组，不按表数量继续拆分配置、运行或文件等技术分类。智能体使用的模型文件缓存归智能体领域，模型提供商与模型定义归模型领域。分文件只用于阅读，不改变模块依赖或事务边界。跨领域资源引用只定义一次；字段类型、可空性、生成列、默认值和索引须与迁移保持一致。SQL 不包含种子、升级数据修正或秘密；MySQL DDL 隐式提交，不能作为整批操作可回滚的承诺。

后端结构变更时，在同一开发任务中同步更新对应阅读副本，反映全部迁移执行后的结构。副本通过开发审核维护，CI 和检查脚本不校验其内容或一致性；实际安装与迁移行为通过 MySQL 集成测试验证。测试方法见[测试与验证](../../development/testing.md)，通用存储和迁移规则见[数据库约定](../README.md)。
