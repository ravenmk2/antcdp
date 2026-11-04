# 短信管理需求与技术设计

状态：当前版本前后端已实现；验证边界见[开发说明](development.md)。边界见[消息管理入口](message-management.md)：短信业务逻辑、数据、模板引擎及测试状态独立于邮件和钉钉。

## 1. 范围与模块

仅系统管理员维护短信供应商配置和模板，进行真实发送测试或本地模拟。目录为 `internal/modules/sms`、`internal/server/sms.go`、`internal/store/mysql/sms*.go`、`web/src/features/sms`，前端 `/admin/sms`。不导入邮件或钉钉业务包，不复用其模板、参数校验、渲染、测试状态或页面组件。

当前版本真实供应商只有阿里云中国站国内短信，每次一个中国大陆手机号；本地正文模式只模拟渲染，不虚构供应商账号。不建设业务类型、业务路由、自动触发、验证码业务、群发队列、自动重试或回执接收。

短信模块内部允许扩展供应商和模板引擎。供应商选择、认证与协议由本模块适配器处理；未来正文型供应商可接收本模块渲染结果，不改变邮件/钉钉接口或表。

## 2. 供应商配置与模板

配置实体命名为 SmsProfile，表名 sms_profile，表示一套供应商账号及发送配置；界面称“短信配置”。与 email_profile 采用相同的命名含义，但两者没有继承关系、共享表或共享业务代码。

配置字段包括 id、不可变 code/provider、名称、说明、enabled、identity/config 结构版本、认证材料、编辑版本及时间戳，操作者通过审计溯源。阿里云 identity 为 AccessKey ID，秘密为 AccessKey Secret；加密保存且完整替换，不允许查询秘密明文/密文。当前版本不开放自定义 endpoint、国际短信、STS 角色或跨配置共享凭证。

固定中国站国内短信服务地址及相应协议，HTTPS 严格验证、限制响应大小与超时、不跟随跳转；禁用 SDK 自动重试。普通 DTO 只返回 AccessKey ID 和 has_secret，不回显秘密前后缀。

| 模板模式 | 配置关联 | 配置 |
| --- | --- | --- |
| remote | 固定一条本模块 aliyun_sms 配置 | 签名、远端模板 ID、抽象参数、供应商参数映射；无本地引擎/正文 |
| local | profile_id 为空 | 正文、抽象参数、样例数据、短信引擎 ID/版本；仅模拟 |

模板资料包括 id、不可变 code/mode、名称、说明、enabled、编辑/结构版本及溯源。remote 的 profile_id 创建后不可变，更换账号新建模板。配置被任意 remote 模板引用时不可删除，包括停用模板；先删除模板再删除配置。配置或模板停用保留数据并阻止真实发送；停用本地模板可编辑和草稿预览，不执行保存最近结果的模拟命令。

阿里云签名、模板内容和审批在供应商侧维护，本系统不申请、同步或编辑远端正文；只展示模板 ID、签名、参数和映射。不要求远端模板有本地正文，不将 ID 当作可渲染文本。

## 3. 抽象参数与远端映射

参数在短信模板内定义，不建立业务类型目录。名称采用 ASCII 字母/下划线开头、后接字母/数字/下划线，大小写敏感。值仅字符串，保留前导零，不默默 trim 或将对象/数组/null 转成字符串。schema 保存说明、是否必填及可选显式默认值；sample_data 使用虚构内容，不是运行默认值。

测试按参数定义生成输入，缺失必填、未知字段、类型不符阻止映射/渲染/发送。远端映射 key 为供应商参数名、value 为抽象参数名；每个 key 一个来源，一个抽象参数可供多个 key 使用，保存时校验来源存在。无参模板使用空 schema/映射。

```json
{
  "parameter_schema": {
    "project_name": {"type": "string", "required": true},
    "task_name": {"type": "string", "required": true}
  },
  "provider_parameters": {
    "product": "project_name",
    "title": "task_name"
  }
}
```

以结构化对象序列化供应商 TemplateParam，不通过文本模板拼接 JSON。测试只传抽象参数，不允许临时覆盖签名、模板 ID 或变量名。远端最终正文以供应商审核模板为准，映射预览不宣称知道其最终正文。

## 4. 短信引擎与本地模拟

短信自己定义引擎接口和代码注册表，通过独立 Render 接口进行源码校验和渲染，并返回受控错误。当前版本 `go_template` 语法版本 1 默认使用 Go text/template；与邮件中同名引擎没有跨模块引用关系。默认值修改不影响已保存模板；未知引擎/版本明确报错，不能回退到邮件引擎。

语法示例：`项目 {{.project_name}} 的任务“{{.task_name}}”已完成。` 不采用 `${name}` 或 fasttemplate。日常短信只需变量；Go 引擎当前版本能力限制由短信独立定义，工程方案允许变量、if/else、with 及受控比较与布尔运算，因输入只含字符串不开放 range/循环。禁止递归调用、跨模板 include、网络/文件/环境变量访问和用户函数。该语法子集不影响邮件支持数组及列表循环。

可选参数在执行前填入字符串默认值/空串，样例单独验证。运行缺失键报错，配合本模块 schema 和受控语法检查，不能只依赖 Go 缺失键选项覆盖所有动态索引。参数值不作为新模板再次解析。编译、输入、执行和输出预算由短信独立控制，不使用邮件模板服务。

草稿可纯渲染预览，无外发、不写最近测试摘要；对已保存启用 local 模板可执行“模拟渲染”，通过独立模拟对话框填写当次参数，返回完整正文和 rendered，摘要不保存正文；不修改模板样例。明确显示“仅模拟、未发送”，无 recipient、真实供应商配置或网络调用。本地输出上限不是运营商计费长度承诺。

## 5. 真实测试与独立诊断

短信自行实现[操作约定](message-management.md#3-各模块分别遵循的操作约定)。测试需要启用且已保存的阿里云配置及其 remote 模板、两个当前版本、一个规范化校验的国内手机号及抽象参数；页面提示可能计费。映射完成后短事务重新核对授权、状态及版本，向 sms_send_log 插入 in_progress 记录并写开始审计，提交后释放锁再外发一次；记录插入失败则不发送。

真实发送的配置/模板最近摘要分别从 sms_send_log 查询，不重复写 last_test；本地模拟只保存 local 模板的 last_simulation，不写真实发送日志。每短信配置/模板同时最多一个真实测试或保存摘要的模拟命令，短信自行限流，不与邮件/钉钉共用状态或计数。执行期间阻止删除参与资源，编辑/停用只影响后续请求。外发后日志仍记录旧快照下的真实结果，最近摘要标记过时。

真实日志状态包括 in_progress、accepted、rejected、failed_before_submit、unknown；rendered 仅用于模拟摘要。解析阿里云业务状态码，不把 HTTP 200 当作受理，accepted 不代表送达。结果只更新当前日志行，终态条件更新防止迟到结果覆盖；超时/断连、结果落库失败等不能确认时为 unknown，启动及每分钟维护将本模块开始超过一分钟的遗留在途状态转为 unknown，不补发。API、SDK 和 UI 均不自动重试，人工再次发送需核对可能已提交的提示。

摘要仅保存受控状态/阶段/原因、资源快照、时间、操作者、手机号掩码及白名单 request_id；没有完整号码、参数、正文或原始供应商错误。审计使用 sms 前缀，平台审计存储不承担短信队列职责。

### 5.1 短信发送日志与保留

用户已确认短信独立发送日志，保留 30 天。每次进入真实外发阶段的测试一行，来源固定为测试（当前版本没有其他发送入口）；校验/授权/版本/限流/映射失败发生在此前，不创建发送记录。本地模拟和映射预览不写 sms_send_log。

记录 test_id、操作者、profile/template ID 及版本、受控名称快照、手机号掩码、起止时间、状态/阶段/原因、受控供应商请求 ID/业务流水 ID。没有完整号码、参数值、正文、AccessKey、认证材料或原始请求/响应；不保存可直接重放的负载。日志不是短信队列，不增加自动重试或“重发日志”按钮。

仅管理员分页按时间、状态、profile_id、template_id、操作者筛选，按 `(started_at DESC,id DESC)` 排序；无手工编辑状态或删除单条 API。配置/模板删除后日志不级联删除，ID 不复用，资料快照保留；过去结果不因当前配置变化而被改写。

从 started_at 起保留 30 天，短信维护循环按索引分批清理已结束记录；在途先按超时/重启规则转终态，不能触发补发。配置/remote 模板最近摘要来自保留期内最后一条日志，过期清空后显示“保留期内暂无发送记录”，不另留重复摘要。数据库备份仍按既有备份保留策略。短信实现本模块清理和查询，不与邮件共用日志表或业务服务。

## 6. 短信数据与事务

| 表 | 主要字段及约束 |
| --- | --- |
| sms_profile | id、code、name、description、enabled、config JSON（provider、AccessKey ID）、config_schema_version、认证密文及格式/密钥版本、row_version、created_at/updated_at；code/name 各自本表唯一 |
| sms_template | id、code、name、description、enabled、可空 profile_id、config JSON（mode、schema、sample、签名/模板 ID/映射或正文/引擎、last_simulation）、config_schema_version、row_version、created_at/updated_at；code/name 各自本表唯一，profile_id 索引用于删除约束 |
| sms_send_log | id、唯一 test_id、actor_user_id、profile_id、template_id、status、started_at/finished_at；snapshot JSON 保存受控名称/版本、recipient_mask、stage/reason_code、provider_request_id/provider_message_id；索引 started_at/id、profile_id/started_at/id、template_id/started_at/id，按查询补充状态及操作者索引 |

remote 的 profile_id 必填且引擎字段为空，content 为签名/模板 ID/映射；local 的 profile_id 为空且引擎字段必填，content 为正文。持久化读取按本模块类型校验，不接受 email_template ID 或钉钉对象。

锁顺序为用户授权 → sms_profile 按 ID → sms_template 按 ID → 本次 sms_send_log；创建 remote 模板先锁父配置，父删除与模板创建串行，local 编辑只锁模板。网络不在事务内；日志终态更新不反向锁父配置。认证替换增加配置 row_version，模板独立 row_version；诊断/日志不更新编辑版本，无变化不增版本。

秘密使用独立 sms 用途，AAD 绑定安装 ID、短信资源/ID 及认证结构版本；当前版本 provider 固定为 aliyun_sms；ETag、审计命名空间独立于 email/dingtalk。三表沿用平台 MySQL 规范，无物理外键/CHECK，无跨消息模块业务关联。

## 7. 短信 API 与页面

根路径 `/api/v1/admin/sms`，仅管理员，沿用 Cookie/CSRF、ETag、no-store 及平台错误结构。

| 路径 | 方法与职责 |
| --- | --- |
| /providers | GET 已实现短信供应商及能力，当前版本阿里云 |
| /profiles、/profiles/{id} | GET/POST 集合、GET/PATCH/DELETE 配置 |
| /profiles/{id}/authentication | PUT 完整替换 AccessKey ID/Secret |
| /profiles/{id}/test | POST 一次真实短信测试，If-Match 对应短信配置 |
| /profiles/{id}/diagnostics | GET 最近短信测试摘要 |
| /template-engines | GET 短信引擎能力/默认值，当前版本 Go |
| /templates、/templates/{id} | GET/POST 集合、GET/PATCH/DELETE 模板 |
| /templates/preview | POST 完整草稿或保存模板引用及版本，互斥；local 正文/remote 映射预览，无外发 |
| /templates/{id}/simulate | POST 已保存启用 local 模板，If-Match，参数输入，更新最近模拟摘要 |
| /templates/{id}/diagnostics | GET 最近模板测试/模拟摘要 |
| /send-logs、/send-logs/{id} | GET 分页筛选日志、GET 脱敏详情；无写入/删除管理 API |

真实测试输入为 `recipient` 和 `template={id,version,parameters}`；模板须属于当前短信配置，不能覆盖配置。创建 remote 模板在事务中锁定并校验父配置存在；不要求 profile_version，真实发送必须同时校验配置与模板版本。列表支持 page/page_size、启停和名称/code 筛选（当前版本不提供 mode/provider 查询参数），每页默认 20、最大 100；当前版本列表返回非秘密完整 DTO。

页面提供短信配置、短信模板、发送日志；remote 展示配置、ID、签名、参数映射，local 展示 Go 源码、参数及样例。真实发送、映射预览、模拟渲染使用不同按钮/结果文案。未实现供应商不显示占位项，本地模拟没有需要秘密的假配置。日志支持受控筛选和详情，无正文或重发按钮。

## 8. 初始限额与验收

当前固定限额：名称 100 字符、说明 1000 字符；源码 16 KiB、输出 4 KiB、最多 50 个字符串参数、参数输入合计 16 KiB；每配置/管理员各每分钟 5 次测试，短信模块并发 4，整体 30 秒/连接 10 秒。供应商更严格限制另行按官方协议校验，不把内部字节上限等同于短信条数/费用。

验收覆盖：配置/模板归属与删除竞争、秘密和业务错误脱敏、国内号码、前导零、映射缺失/重复目标/一对多/无参数、Go 语法及限额、本地模拟无网络且不写发送日志；发送前冲突不外发、外发后变更保留结果、超时/重启不重试、限流和摘要过时；日志先持久化再外发、分页筛选、脱敏、删除配置保留历史及 30 天清理；同值 ID 不得串用邮件/钉钉数据。

当前按阿里云 ACS3-HMAC-SHA256 官方签名协议直连 SendSms，不引入 SDK、代理或重试。协议签名、业务响应分类及隔离实库流程已验证；不预置业务模板，未使用真实 AccessKey 或付费短信发送。

参考：[阿里云 SendSms](https://help.aliyun.com/zh/sms/developer-reference/api-dysmsapi-2017-05-25-sendsms)、[Go text/template](https://pkg.go.dev/text/template)、[UI 规范](ui-design.md)。

### 8.1 当前 DTO 与扩展细节

模板 POST/PATCH 提交完整结构；local 的 profile_id 在请求/响应中使用字符串 "0" 表示无配置，数据库列为 NULL。remote 的 engine_id 为空、engine_version 为 0、body_template 为空；local 则不带签名/远端模板 ID/映射。配置 PATCH 修改提供的非 null 字段，无变化不增版本。各供应商实现本模块 Provider.Send 接口，在代码注册表登记；目录返回 id/name/template_mode。引擎独立注册，目录返回 id/version/name/default。本地模拟每操作者/模板每分钟最多 5 次，使用本模块并发槽；计数不进入真实发送日志，进程重启清空内存模拟限流窗口。
