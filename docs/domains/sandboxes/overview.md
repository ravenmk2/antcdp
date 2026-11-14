# 云电脑与沙箱

云电脑为执行账号提供工作文件、运行环境和物理操作。管理协议、资源类型与工具 Schema 以服务和适配器代码为准。

## 源码入口

- [平台宿主](../../../internal/modules/agents)
- [沙箱适配](../../../internal/agentadapters)
- [HTTP 装配](../../../internal/server/agents_cloud.go)
- [工作文件入口](../../../internal/server/agents_sandbox_files.go)

## 关键边界

- 逻辑电脑、远端实例、持久卷、会话绑定与执行租约分别管理，删除其中一个不能推定其他资源已删除。
- 逻辑结束不代表物理活动结束；未核实的远端操作保留引用和占用，不能强制释放后并发写入。
- 工作文件与平台正式成果分开，跨存储复制验证来源、大小与摘要。
- 执行工作负载不得获得平台密钥或控制凭据；路径、链接、网络与控制面隔离必须在可信边界执行。

## 验证

从所属模块的单元测试、[HTTP 测试](../../../internal/server/)和[MySQL 集成测试](../../../internal/store/mysql/)选择受影响用例。运行方法及真实外部服务的验证边界见[测试与验证](../../development/testing.md)。 部署方法见[沙箱环境](../../operations/sandboxes.md)。
