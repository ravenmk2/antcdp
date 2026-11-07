# 邮件管理需求与技术设计

状态：当前版本前后端已实现；验证边界见[开发说明](development.md)。总体边界见[消息管理入口](message-management.md)：邮件业务逻辑、数据、模板引擎及测试状态独立于短信和钉钉。

## 1. 范围与模块

仅系统管理员管理 SMTP、发件名称、邮件模板、临时附件、预览及发送测试。源码为 `internal/modules/email`、`internal/server/email.go`、`internal/store/mysql/email*.go`、`web/src/features/email`，前端路由 `/admin/email`。不导入短信/钉钉业务包，不共用模板/配置组件或发送服务；可以使用平台基础设施与 Go 标准库。

确认支持 SMTP TLS 直连/STARTTLS、用户名及密码/授权码（TLS 内 SMTP AUTH PLAIN）、纯文本/HTML、独立邮件模板及发送时附件。模板编辑采用源码、参数说明、样例数据和隔离预览。当前范围不接业务触发、不存模板固定附件、不做拖拽设计器。抄送、密送、Reply-To 编辑、CID 内嵌图片、OAuth 及无认证中继不纳入当前版本工程方案。

## 2. SMTP 与发件名称

配置实体命名为 EmailProfile，表名 email_profile，表示一套 SMTP 连接、认证和发件身份设置；界面称“邮件配置”。不用 channel 暗示本模块还承担业务渠道选择或路由。

| 字段组 | 设计 |
| --- | --- |
| 资料 | id、不可变 code、名称、说明、enabled、溯源、版本 |
| 连接 | host、port、tls_mode=`implicit_tls`/`starttls`、可选公共 custom_ca_pem |
| 认证 | username 与加密 password；授权码按密码处理，完整替换身份/秘密 |
| 发件地址 | from_address，一个邮箱地址，与登录账号分开；信封发件地址默认与其相同 |
| 显示名称 | 多个有稳定 ID 的名称，至少一项且恰好一个默认项 |

默认端口 465，切换模式时可手动改为服务器实际端口；不根据端口自动猜测或降低 TLS 模式。严格验证证书和主机名，STARTTLS 不可用时失败，不能退回明文发送认证。支持平台允许的私网 SMTP，DNS 校验与拨号绑定到经过校验的地址，TLS SNI 保留原主机名。没有忽略证书、任意代理或原始邮件头编辑。

名称去首尾空白后非空，同 SMTP 配置内判重。名称 ID 不随改名改变；集合和默认项同事务、同一个 SMTP ETag 更新。删除默认项须同时指定新默认项，不能删除全部项。测试省略名称 ID 使用默认项，显式失效或跨配置 ID 报错。

普通 DTO 不返回 password、密文、密码长度，只返回 username 和 has_secret。可以保存未经外部验证但结构合法完整的配置；enabled 默认 true，停用保留数据并禁止新发送。删除 SMTP 不删除独立模板，发件名称随父配置清理；发送日志保留到期，原配置 ID 和受控资料快照继续可查。

## 3. 独立邮件模板与引擎

模板不关联 SMTP，不保存发件地址、名称、收件人或附件。字段包括 id、code、名称、说明、enabled、engine_id/engine_version、subject_template、body_format=`text`/`html`、body_template、可选 text_body_template、parameter_schema、sample_data、row_version 及溯源。

邮件模块定义自己的引擎接口和代码注册表，覆盖源码/schema 校验、限额渲染和受控错误。当前版本 `go_template` 语法版本 1 为新模板默认项；主题/纯文本用 text/template，HTML 用 html/template。未来新增邮件引擎不改变短信引擎注册、标识空间、默认值或数据结构。未知引擎/版本明确报错，不自动回退；改变默认值不重解释已有模板。

输入是邮件模块规范化后的普通数据对象。参数支持字符串、数字、布尔、对象、数组，结构和元素类型由本模板 schema 定义；schema 为受控子集，不读取外部引用。字段名为字母/下划线开头、后接字母/数字/下划线，大小写敏感。拒绝未知字段、错误类型及缺失必填项；可选字段先填显式默认值或类型零值。sample_data 仅作虚构示例，不是运行默认输入。

支持变量、if/else、range、with 及受控比较与布尔运算。当前版本工程方案不开放跨模板 include、递归 template 调用、用户函数、文件/网络/环境变量访问；不传递带方法、函数、数据库资源或秘密的对象。HTML 动态字符串不转成 template.HTML 等可信类型。

保存时验证源码/schema/样例；字段引用由执行样例及发送前渲染检查，未执行分支中的缺失字段可能在实际输入激活该分支时才报错。循环局部变量、动态索引不能完全依赖自动提取；执行前 schema 校验、引擎受控语法检查及运行错误共同保证。缺失键设为错误，但不能把它当作对所有索引写法的完整校验。

限制输入对象/数组、语法深度、循环乘积预算和输出字节数，使用限长 writer。需要编译期和输入期限制没有输出的巨量循环，不能宣称仅 context 超时就能中断任意 Go 模板。模板引擎行为属于本模块，短信不复用此实现。

```html
<h2>{{.title}}</h2>
<ul>{{range .items}}<li>{{.name}}：{{.status}}</li>{{end}}</ul>
{{if .detail_url}}<p><a href="{{.detail_url}}">查看详情</a></p>{{end}}
```

主题、正文和可选备用正文由同一份参数渲染。HTML 与备用正文同时存在时使用 multipart/alternative，附件外层使用 multipart/mixed。不以简单去标签代替备用正文，不保证浏览器预览与所有收件客户端像素一致。MIME 库负责 Unicode 主题、文件名及地址编码，拒绝邮件头 CR/LF 注入。

## 4. 编辑与隔离预览

页面提供邮件配置、邮件模板、发送日志三个列表；SMTP 详情含配置/认证/发件名称/测试，模板详情含主题、格式、源码、参数、样例及预览。草稿可以纯渲染预览；实际发送只使用已保存启用模板及 SMTP，模板源不能在测试请求中临时覆盖。

草稿预览无 SMTP 访问、不保存发送摘要，返回渲染主题、HTML/文本及备用正文，响应 no-store。HTML 使用隔离 iframe，sandbox 不授予脚本、同源、表单、弹窗及顶层导航权限，CSP 限制活动内容和远端资源。远端图片默认不加载，链接不自动打开；不能将渲染结果直接注入应用 DOM。HTML 参数转义不等于清洗了管理员模板源码。

测试一次一个 To 地址，选择本模块 SMTP、发件名称、模板和参数，或在 SMTP 测试面板直接输入主题和正文；附件发送时另选。保留未保存提醒、并发版本冲突、浅深主题、桌面缩放及键盘可访问性。不依赖访问短信/钉钉页面加载样式。

## 5. 临时附件

当前版本不建 email_attachment 表，不提供独立上传/删除 API、附件 ID、跨请求复用或上传会话。管理员在测试表单选择本地文件，点击发送时将参数和文件一起通过一个 multipart 请求提交；重新发送需要重新上传附件。

处理请求前校验会话、管理员权限、CSRF、请求大小和并发配额，再按每文件/合计上限读取 multipart；发送前在事务中重新核对权限和配置版本。文件仅存于有上限的请求内存缓冲，不落盘、不保存数据库元数据。发送结束清零附件字节并释放请求引用；失败/取消路径释放请求缓冲。没有跨请求暂存、重启恢复或临时目录清理任务。

文件名只作展示/MIME 元数据，规范化并拒绝 CR/LF，不作为磁盘路径。拒绝服务器文件路径、外部下载 URL 或其他请求的临时标识。附件字节和文件名不进入发送日志、审计或摘要，日志只保留数量和原始总字节数。附件不是模板资产，也不是可重放任务。

## 6. 邮件测试与诊断

邮件独立实现[操作约定](message-management.md#3-各模块分别遵循的操作约定)。发送前完成参数校验、渲染及附件大小检查；MIME 在网络连接前组装，组装失败记录提交前失败；短事务重新核对管理员、SMTP/模板版本及发件名称，向 email_send_log 插入 in_progress 记录并写开始审计，提交后释放锁，再调用 SMTP 一次。日志插入或事务失败时不外发。

每个 SMTP 及参与模板同时最多一次发送测试，邮件独立控制并发和限流，不与短信/钉钉共用业务计数。外发期间禁止删除参与的 SMTP/模板；编辑/停用只影响后续操作，日志记录旧快照下的真实结果，最近摘要标记过时。即使操作者外发后降权，内部仍记录结果和清理请求附件，但不向其返回受保护详情。

状态为 in_progress、accepted、rejected、failed_before_submit、unknown。SMTP 接受不等于送达；超时/中断不能确认时为 unknown。调用结束只更新对应日志行，不覆盖其他发送记录；最终状态用条件更新防止迟到结果覆盖已完成结果。结果无法落库或进程崩溃时，遗留 in_progress 在启动及每分钟维护时将开始超过一分钟的在途记录转为 unknown，不自动重发。SDK、客户端及 UI 均禁用自动重试。

SMTP 和模板的“最近一次”都从 email_send_log 查询，不在配置/模板表重复保存 last_test。按 started_at、id 倒序选取，摘要绑定本次 SMTP/模板版本；名称/认证/配置变化或配置删除使旧摘要过时，但不改变历史发送状态。草稿预览不写发送日志。

### 6.1 发送日志与保留

用户已确认独立邮件发送日志，保留 30 天。每次进入真实外发阶段的测试记录一行，来源固定为测试（当前版本没有其他发送入口）；校验、授权、版本、限流、附件上传或渲染失败发生在外发准备前，不创建发送记录，也不伪装成供应商失败。日志不保存足以重放邮件的内容，不是 outbox 或重试队列。

保存 test_id、操作者 ID、profile/template ID 及版本、sender_name ID、受控名称快照、目标掩码、起止时间、状态/阶段/原因、SMTP 可确认的受控响应码、附件数量/总字节数。可存平台生成的 Message-ID 用于关联，不能宣称它是收件人已收到的凭证；没有可用供应商请求 ID 时为空。没有正文、主题内容、参数值、附件名/字节、完整目标、SMTP 账号材料或原始错误。

仅系统管理员分页查询，按时间范围、状态、profile_id、template_id、操作者筛选；排序 `(started_at DESC,id DESC)`。没有界面手工改状态或删除单条记录；删除配置/模板不级联日志，ID 不复用，日志快照继续可读。

保留期按服务端 started_at 起算 30 天，邮件维护循环按索引分批清理已结束记录；执行中的记录先按测试超时/进程恢复规则终结，不能当作清理策略直接重发。日志过期后最新诊断可能为空，界面显示“保留期内暂无发送记录”，不伪造历史成功。该期限针对运行数据库，备份仍遵循既有备份保留策略。审计只记录操作事实，不额外复制正文或完整接收目标。

## 7. 邮件数据模型与事务

四张独立表，无短信/钉钉资源引用；沿用 MySQL/逻辑关联/无物理外键和 CHECK 的仓库规则。

| 表 | 字段及约束 |
| --- | --- |
| email_profile | id、code、name、description、enabled、类型化 config JSON（含连接、from_address、username）、config_schema_version、认证密文及格式/密钥版本、row_version、created_at/updated_at；code/name 各自本表唯一，操作者通过审计溯源 |
| email_sender_name | 随机 CHAR(32) 稳定 id、profile_id、name、is_default；UNIQUE(profile_id,name)，应用事务确保恰好一个默认项 |
| email_template | id、code、name、description、enabled、config JSON（引擎 ID/版本、主题/正文/备用正文及格式、parameter_schema、sample_data）、config_schema_version、row_version、created_at/updated_at；code/name 各自本表唯一，无 profile_id |
| email_send_log | id、唯一 test_id、actor_user_id、profile_id、可空 template_id、status、started_at/finished_at；snapshot JSON 保存 sender_name_id、受控名称/版本、recipient_mask、stage/reason_code、response_code、message_id、attachment_count/attachment_bytes；索引 started_at/id、profile_id/started_at/id、template_id/started_at/id，按查询补充状态及操作者索引 |

锁顺序：用户授权 → email_profile 按 ID → email_template 按 ID → 本次 email_send_log。独立模板编辑只锁本身时不反向申请配置锁。大文件 IO 和网络不在锁内执行；日志终态更新不再反向锁父配置，父配置可同时被编辑。

配置与名称集合共用 row_version，认证替换增加同一 row_version，不另设材料版本；模板独立 row_version。诊断不更新编辑版本，无变化不增版本、不重复审计。秘密用途为 email，AAD 绑定安装、资源种类/ID及认证结构版本；ETag 和审计前缀独立于 sms/dingtalk/integrations。

## 8. 邮件 API

根路径 `/api/v1/admin/email`，仅管理员、Cookie/CSRF、no-store，沿用平台 HTTP 约定。

| 路径 | 方法与职责 |
| --- | --- |
| /profiles | GET 列表、POST 创建 SMTP |
| /profiles/{id} | GET、PATCH、DELETE SMTP 聚合；PATCH 可原子编辑名称及默认项 |
| /profiles/{id}/authentication | PUT 完整替换 username/password |
| /profiles/{id}/test | POST 一次邮件发送 |
| /profiles/{id}/diagnostics | GET 最近邮件测试摘要 |
| /template-engines | GET 仅邮件引擎目录/能力/默认值，当前版本 Go |
| /templates、/templates/{id} | GET/POST 集合，GET/PATCH/DELETE 单份邮件模板 |
| /templates/preview | POST 完整草稿或已保存模板引用及版本，二者互斥；纯渲染 |
| /templates/{id}/diagnostics | GET 最近模板发送测试摘要 |
| /send-logs、/send-logs/{id} | GET 分页筛选日志、GET 脱敏详情；无写入/删除管理 API |

测试 If-Match 是 SMTP 配置版本。无附件时可使用 JSON；有附件时 multipart 的 `payload` 字段提交同结构 JSON、`attachments` 提交文件。payload 为 `recipient`、可选 `sender_name_id`，以及 `content={subject,body_format,body,text_body?}` 或 `template={id,version,parameters}`；不再提供 attachment_ids。两种编码共用邮件模块内同一 DTO 校验和发送用例，不跨模块复用。模板 ID 只在邮件空间解释，版本令牌不能跨模块使用。

名称集合更新为 `sender_names:[{id?,name,default}]`；已有项使用本配置 id，新项省略 id 或传空串，由服务端分配稳定 ID。整组原子替换、恰好一个 default=true，不需要 client_key 或单独 default_sender 字段。

列表支持 page/page_size、启停及名称/code 查询，每页默认 20、最大 100；当前版本列表返回本模块非秘密 DTO，详情与列表使用同一资源结构。邮件 JSON 上限 512 KiB，附件独立限制，不用 Base64 JSON 上传。错误定位语法/参数字段，不回显整份运行数据或秘密。

## 9. 初始限额与验收

当前固定限额，不增加设置页：名称 100 字符、说明 1000 字符、发件名称最多 20 项；源码 128 KiB、输出 512 KiB、主题 200 字符；参数/样例各 64 KiB、schema 深度 4、字段总数 100、数组 100 项、循环乘积预算 10,000。附件最多 5 个、单个 5 MiB、合计 10 MiB，multipart 总请求上限 12 MiB（包含 payload 和分隔开销）；读取前取得上传并发槽，防止大量请求占用临时空间。按 MIME 编码后的整封邮件大小再次检查，无跨请求暂存配额/一小时有效期概念。

邮件外发并发上限 4；每管理员及每 SMTP 各每分钟 5 次；整体网络超时 30 秒、连接 10 秒。预览另有本模块 4 个并发槽及输入预算，不改变短信或钉钉业务计数。

验收覆盖：TLS/STARTTLS 无降级、认证/发件地址授权失败、Unicode/MIME、HTML/备用正文/附件、默认名称原子性；模板分支/循环/缺参/错误类型/限额及 HTML 隔离；multipart 校验、超限中止、客户端取消、请求内存释放与重启不重发；外发后变更/降权、未知结果、重启不重发、摘要失效；日志先落库后外发、终态更新、脱敏、分页筛选、删除配置保留历史及 30 天清理。验证模板跨 SMTP 使用，不依赖短信或钉钉记录。

当前使用 Go net/smtp、mime/multipart、quoted-printable/base64，不增加供应商 SDK 或 SMTP 依赖。TLS/STARTTLS、MIME、受理/拒绝/末次响应丢失已通过协议夹具验证；未使用真实邮箱账号发送。

参考：[Go text/template](https://pkg.go.dev/text/template)、[Go html/template](https://pkg.go.dev/html/template)、[RFC 5322](https://www.rfc-editor.org/rfc/rfc5322.html)、[UI 规范](ui-design.md)。

### 9.1 当前 DTO 细节

模板 POST/PATCH 提交完整模板结构（包含 code、name、enabled、engine_id/engine_version、subject_template、body_format、body_template、text_body_template、parameter_schema、sample_data）；PATCH 不是 JSON Merge Patch，字段按整份替换。配置 PATCH 只替换提交的非 null 字段，空改动返回原版本；认证始终走独立完整替换接口。参数样例必填项不能缺失。引擎目录返回 id/version/name/default；当前版本代码注册表同时驱动查找及目录，不加载外部插件。
