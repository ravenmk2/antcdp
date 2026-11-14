# 模型模块

模型模块独立维护提供商、模型配置和协议适配。提供商目录、默认地址、能力值及参数 Schema 以运行目录和注册代码为准，不在文档复制。

## 源码入口

- [核心协议](../../../internal/modelcore)
- [提供商适配器](../../../internal/modeladapters)
- [管理用例](../../../internal/modules/models)
- [HTTP 装配](../../../internal/server/models.go)
- [前端功能](../../../web/src/features/models)

## 关键边界

- 声明能力与实际诊断结果分开。不能从模型名或一次调用推断完整能力。
- 原生消息、工具关联、顺序和供应商字段不能通过展示文本反向重建。适配演进须验证历史重放。
- 诊断、发现与配置修改分别管理。取消等待不证明远端未执行，适配器不能隐藏重试。

## 验证

从所属模块的单元测试、[HTTP 测试](../../../internal/server/)和[MySQL 集成测试](../../../internal/store/mysql/)选择受影响用例。运行方法及真实外部服务的验证边界见[测试与验证](../../development/testing.md)。
