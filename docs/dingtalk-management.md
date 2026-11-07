# 钉钉机器人管理需求与技术设计

状态：当前版本前后端已实现；验证边界见[开发说明](development.md)。边界见[消息管理入口](message-management.md)：钉钉业务逻辑、数据和测试状态独立于邮件与短信。

## 1. 范围与模块

仅系统管理员管理钉钉群自定义机器人并发送测试。目录为 `internal/modules/dingtalk`、`internal/server/dingtalk.go`、`internal/store/mysql/dingtalk*.go`、`web/src/features/dingtalk`，前端 `/admin/dingtalk`。不注册到邮件、短信或服务集成目录，不引用它们的业务对象、模板、凭证、发送服务或前端业务组件。

每个机器人配置一套 access token/secret，同类可建多条；Token 可能同时决定群目标，不强行拆成“连接＋可替换凭证”。当前版本支持文本/Markdown，排除 @ 提醒、卡片、机器人收消息、回调、业务路由及自动通知。不建设模板表或模板引擎。

## 2. 配置与协议

资料为 id、不可变 code、名称、说明、enabled、创建/更新时间及审计操作者、编辑版本。名称/code 在本模块各自唯一，采用仓库既有长度/格式约定。创建可未经外部验证，但结构和秘密完整；停用保留配置并阻止新测试。

页面输入 Access Token、签名密钥（secret），两项必填，不接收完整 URL。采用加签认证，不提供关键词配置。Token/secret 同属一套秘密，创建或独立认证替换完整提交并加密保存；常规 DTO 不返回明文/密文/前后缀。

服务端固定构造 `https://oapi.dingtalk.com/robot/send`，按官方协议使用 secret 加签并附 access token；含秘密 URL 不进入详情、日志、审计、错误或诊断。HTTPS 严格验证证书，使用固定主机的 HTTPS 访问，禁止任意地址、重定向、关闭 TLS 或客户端覆盖签名。

文本和 Markdown 正文原样发送，不追加关键词或换行前缀；Markdown 单独填写标题。IP 白名单在钉钉侧维护，不提供代管设置或伪造出口地址。

## 3. 独立测试流程

本模块自行实现[操作约定](message-management.md#3-各模块分别遵循的操作约定)，不调用公共消息状态机。测试使用已保存启用机器人和当前版本；文本/Markdown 为当次输入，不存成模板。

短事务重新检查管理员、状态、版本，记录 in_progress 摘要及开始审计，再释放锁，基于快照解密并外发一次。每机器人同时一个测试，本模块限流，不使用邮件/短信计数。执行中禁止删除；编辑/停用影响后续操作，不能撤销已提交消息。

检查 HTTP 及钉钉业务返回码，accepted 表示受理，不代表群成员已读。明确拒绝为 rejected，确定提交前失败为 failed_before_submit；超时、发送后断连、进程中断或结果落库失败不能确认时为 unknown。SDK/客户端/UI 不自动重试，启动及每分钟维护只将开始超过一分钟的本模块在途状态恢复为 unknown，不补发。

发送期间配置变化时保存原快照结果并标记 outdated，不丢弃事实后提示直接重试。操作者外发后失去权限，后台仍记录结果但不返回已无权查看的详情。比较 test_id/开始顺序，防止迟到结果覆盖新测试。

最近摘要包括受控状态/阶段/原因、起止时间、测试 ID、操作者、机器人版本（供应商未提供可用请求 ID 时不伪造）；目标以本地机器人身份表达，不存 Token、完整 URL、secret、内容或原始错误。审计使用 dingtalk 前缀，不承担投递队列。

## 4. 独立数据表与版本

使用 `dingtalk_robot` 一表：id、code、name、description、enabled、config JSON（当前写入空对象 `{}`，不重复保存资料或认证状态）、config_schema_version、secret_ciphertext/secret_format_version/secret_key_version、row_version、last_test、created_at/updated_at。code/name 各自本表唯一，无其他消息模块的 channel_id/template_id 等关联。

秘密使用独立 dingtalk 派生用途，AAD 绑定安装 ID、机器人资源/ID及认证结构版本；ETag 与 email/sms 分开。认证替换递增 row_version；资料编辑递增 row_version；无变化不增版本。last_test 不影响编辑版本。

锁顺序为用户授权 → dingtalk_robot 按 ID；配置、认证和审计同事务，网络不持锁。删除清理秘密/摘要，审计保留资源历史，不影响邮件/短信。沿用 MySQL 单数表名/无物理外键及 CHECK 约定，不建立共享消息表。

## 5. API 与 UI

根路径 `/api/v1/admin/dingtalk`，仅管理员，平台 Cookie/CSRF、no-store、ETag 和错误结构。

| 路径 | 方法与职责 |
| --- | --- |
| /robots | GET 列表、POST 创建机器人 |
| /robots/{id} | GET、PATCH、DELETE 配置 |
| /robots/{id}/authentication | PUT 完整替换 access_token/secret |
| /robots/{id}/test | POST 文本/Markdown 测试，If-Match 对应机器人 |
| /robots/{id}/diagnostics | GET 最近摘要及 outdated |

测试请求为 `{format,body,title?}`，format 为 text/markdown，Markdown 要求标题；不接受 recipient、@、临时 Token、URL 或模板引用。编辑只修改非秘密资料，不以星号占位覆盖秘密。

列表支持 page/page_size、启停及名称/code 筛选，默认 20、最大 100；展示机器人、状态、最近测试及查看入口，不显示常驻功能提示。详情按基本信息、机器人认证、最近测试单列组织；发送测试作为最近测试面板的主要操作，与刷新结果并排；启停与删除收纳到页头操作菜单。测试结果显示状态与时间，诊断信息按需展开，发送后刷新详情与列表摘要。

新建字段顺序为名称、编码（可选）、Access Token、签名密钥、说明（可选）；编辑资料与更新认证分开。Token/secret 离开录入时清空，不写浏览器存储。测试抽屉说明目标群，正文不重复显示只读预览；未知状态提示先核实，不自动重试。请求和响应均无 keyword 字段，提交未知字段按公共协议拒绝。


## 6. 初始限额与验收

当前固定限额：名称 100 字符、说明 1000 字符；正文 16 KiB，Markdown 标题 100 字符，普通请求体 64 KiB，响应 64 KiB。每管理员/机器人各每分钟 5 次测试，本模块外发并发 4，整体 30 秒/连接 10 秒。内部上限不替代钉钉实际频控。

验收覆盖：固定目标和受控网络、签名/时钟问题、秘密存储/日志脱敏、正文原样发送、文本/Markdown、HTTP 200 但业务拒绝、超时未知、不重试/不补发、摘要过时；越权、版本冲突、删除竞争和独立 ID/ETag；无需邮件/短信资源即可独立使用。

初始迁移包含独立机器人表，无新增外部依赖。加签/响应分类和隔离实库测试通过；未使用真实 Token 或实际发群消息。钉钉侧审核、频控和消息长度限制仍以其实际响应为准。

参考：[钉钉自定义机器人](https://open.dingtalk.com/document/group/custom-robot-access)、[安全设置](https://open.dingtalk.com/document/robots/customize-robot-security-settings)、[UI 规范](ui-design.md)。
