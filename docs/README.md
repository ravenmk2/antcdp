# 文档入口

功能、接口、字段、默认值和支持范围以代码及测试为准。文档维护源码导航、稳定的架构关系、开发方法和无法从局部代码推断的安全与恢复边界，不维护第二份功能实现说明。

## 架构与开发

- [架构与模块边界](architecture/overview.md)
- [技术选择](architecture/decisions.md)
- [扩展与依赖](architecture/extensibility.md)
- [本机开发](development/getting-started.md)
- [前端技术与工程](development/frontend.md)
- [测试与验证](development/testing.md)
- [HTTP 开发约定](api/conventions.md)
- [数据库约定](database/README.md)与[结构阅读副本](database/schema/README.md)

## 领域源码导航

- [平台与身份](domains/platform/identity.md)
- [项目与团队](domains/collaboration/overview.md)
- [项目仓库](domains/delivery/repositories.md)
- [服务集成](domains/integrations/overview.md)
- [远程主机](domains/remote-hosts/overview.md)
- [消息模块](domains/messaging/overview.md)
- [模型](domains/models/overview.md)
- [搜索与网页读取](domains/web-access/overview.md)
- [智能体](domains/agents/overview.md)与[执行恢复](domains/agents/runtime.md)
- [云电脑与沙箱](domains/sandboxes/overview.md)

## 运行方法

- [安装与容器部署](operations/deployment.md)
- [运行配置](operations/configuration.md)
- [镜像发布](operations/image-publishing.md)
- [沙箱环境](operations/sandboxes.md)

## 维护

- 修改实现时更新受影响的代码和测试；只有职责、通用方法或稳定边界改变时同步文档。
- 版本、表数量、完整字段及能力目录、构建配置和当前限额从源码查阅，不手工复制到多篇文档。
- 不保留交付阶段、历次确认、过程日志、已完成改造或未落实的路线图。兼容条件、恢复要求和重要技术取舍保留在负责该主题的一处文档。
- 领域之间使用链接表达依赖，不把一个独立模块的说明寄放在其某个消费者的目录。
- 文档不规定 UI/UX 设计。实际环境、凭据、部署记录和验证产物保存在被忽略的本机目录；开发规范见 [AGENTS.md](../AGENTS.md)。
- 调整路径时同步入口和引用，通过审核确认引用内容仍然适用。文档链接和 schema 阅读副本不纳入 CI 或检查脚本；后端结构变更时同步更新对应 schema 阅读副本。
