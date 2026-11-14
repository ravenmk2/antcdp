# 消息模块

邮件、短信和钉钉分别拥有业务模型、服务、数据及接口。它们共享基础设施，不共享业务身份、凭证或发送状态。具体供应商、模板能力和输入参数以代码为准。

## 源码入口

- [邮件](../../../internal/modules/email)
- [短信](../../../internal/modules/sms)
- [钉钉](../../../internal/modules/dingtalk)
- [邮件 HTTP](../../../internal/server/email.go)
- [短信 HTTP](../../../internal/server/sms.go)
- [钉钉 HTTP](../../../internal/server/dingtalk.go)

## 关键边界

- 预览、模拟和真实发送是不同操作。真实发送可能产生外部副作用和费用，受理不等于送达。
- 开始外发前记录必要事实；结果未知时保留不确定状态，不能自动补发。日志不是可重放发送队列。
- 供应商秘密、消息正文、完整接收目标和附件不得进入普通审计与诊断日志。
- 邮件 HTML 按不可信内容隔离；模板转义不能替代对活动内容和外部资源的限制。

## 验证

从所属模块的单元测试、[HTTP 测试](../../../internal/server/)和[MySQL 集成测试](../../../internal/store/mysql/)选择受影响用例。运行方法及真实外部服务的验证边界见[测试与验证](../../development/testing.md)。
