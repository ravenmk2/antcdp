# 云电脑与沙箱

沙箱提供独立的执行、文件系统和实例生命周期能力。云电脑是使用沙箱实现的持久工作空间产品；Agent 和脚本是其上层调用方，基础沙箱不要求创建 Agent、会话或云电脑。管理协议、资源类型与工具 Schema 以服务和适配器代码为准。

## 源码入口

- [沙箱服务与持久化契约](../../../internal/modules/sandboxes)
- [云电脑产品与生命周期编排](../../../internal/modules/cloudcomputers)
- [Agent 授权、工具及工作空间适配](../../../internal/modules/agents)
- [沙箱契约](../../../internal/sandboxcore)
- [OpenSandbox 适配](../../../internal/sandboxadapters/opensandbox)
- [原生文件系统契约](../../../internal/sandboxcore/filesystem.go)
- [工作文件编排](../../../internal/modules/agents/workspace_native.go)
- [HTTP 装配](../../../internal/server/agents_cloud.go)
- [工作文件入口](../../../internal/server/agents_sandbox_files.go)

## 关键边界

- 云电脑重建创建新的实例身份，保持逻辑电脑和持久卷身份；命令、租约及文件操作固定到原实例，不随当前实例指针切换。删除实例不能推定持久卷已删除。
- 基础租约以调用方标识管理占用；Agent 轮次、技能安装及成果发布保留在 Agent 领域。租约到期或取消请求被接受，不代表远端执行已结束。
- 云电脑公开操作状态和幂等回执由产品操作记录承担，不复用 Agent 操作表。
- 逻辑结束不代表物理活动结束；未核实的远端操作保留引用和占用，不能强制释放后并发写入。
- 工作文件与平台正式成果分开，跨存储复制验证来源、大小与摘要。
- 平台负责路径授权、字节限制和内容完整性；链接、网络、进程与控制面隔离由沙箱后端提供。平台不向工作负载注入模型或检索密钥。
- 默认使用官方原生执行和文件 API，不依赖辅助程序、加固镜像或固定 UID；保留后端抽象供未来替换。
- 原生文件 API 不提供平台级原子条件写入保证。超时写入不重放，未核实的写入只能在原实例终止得到确认后释放。普通路径元数据比较不提供原子 CAS。

## 验证

从所属模块的单元测试、[HTTP 测试](../../../internal/server/)和[MySQL 集成测试](../../../internal/store/mysql/)选择受影响用例。运行方法及真实外部服务的验证边界见[测试与验证](../../development/testing.md)。 部署方法见[沙箱环境](../../operations/sandboxes.md)。
