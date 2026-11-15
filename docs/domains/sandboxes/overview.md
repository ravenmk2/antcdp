# 云电脑与沙箱

云电脑为执行账号提供工作文件、运行环境和物理操作。管理协议、资源类型与工具 Schema 以服务和适配器代码为准。

## 源码入口

- [平台宿主](../../../internal/modules/agents)
- [沙箱契约](../../../internal/sandboxcore)
- [OpenSandbox 适配](../../../internal/sandboxadapters/opensandbox)
- [原生文件系统契约](../../../internal/sandboxcore/filesystem.go)
- [工作文件编排](../../../internal/modules/agents/workspace_native.go)
- [HTTP 装配](../../../internal/server/agents_cloud.go)
- [工作文件入口](../../../internal/server/agents_sandbox_files.go)

## 关键边界

- 逻辑电脑、远端实例、持久卷、会话绑定与执行租约分别管理，删除其中一个不能推定其他资源已删除。
- 逻辑结束不代表物理活动结束；未核实的远端操作保留引用和占用，不能强制释放后并发写入。
- 工作文件与平台正式成果分开，跨存储复制验证来源、大小与摘要。
- 平台负责路径授权、字节限制和内容完整性；链接、网络、进程与控制面隔离由沙箱后端提供。平台不向工作负载注入模型或检索密钥。
- 默认使用官方原生执行和文件 API，不依赖辅助程序、加固镜像或固定 UID；保留后端抽象供未来替换。
- 原生文件 API 不提供平台级原子条件写入保证。超时写入不重放，历史辅助程序记录仅按已有句柄核实收尾。

## 验证

从所属模块的单元测试、[HTTP 测试](../../../internal/server/)和[MySQL 集成测试](../../../internal/store/mysql/)选择受影响用例。运行方法及真实外部服务的验证边界见[测试与验证](../../development/testing.md)。 部署方法见[沙箱环境](../../operations/sandboxes.md)。
