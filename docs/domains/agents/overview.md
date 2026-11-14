# 智能体开发入口

智能体领域负责配置、资源绑定、会话和运行。执行核心与平台宿主分离；业务细节、状态枚举、字段和接口均以代码及测试为准。

## 源码入口

- [执行核心](../../../internal/agentcore)
- [平台宿主](../../../internal/modules/agents)
- [MCP 与技能资源](../../../internal/modules/agentresources)
- [框架及环境适配](../../../internal/agentadapters)
- [HTTP 与流装配](../../../internal/server/agents.go)
- [前端功能](../../../web/src/features/agents)

## 关键边界

- 内容权限、执行账号和实际操作者分别建模。管理员资格不能自动授予读取其他真人对话的权限。
- 工具定义、模型输出、用户文件和 MCP 描述不能扩大已授权范围。
- 模型、网络检索和沙箱保留独立职责，智能体通过明确端口使用这些能力。

## 验证

从所属模块的单元测试、[HTTP 测试](../../../internal/server/)和[MySQL 集成测试](../../../internal/store/mysql/)选择受影响用例。运行方法及真实外部服务的验证边界见[测试与验证](../../development/testing.md)。 执行与恢复关系见[运行机制](runtime.md)。
