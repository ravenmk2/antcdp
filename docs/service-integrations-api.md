# 服务集成 API 设计

更新日期：2026-10-29。状态：已实现的 GitLab 管理与接收契约；不兼容旧 `/integrations` 接口及以 integration_id 路由的 Webhook。领域及数据库见[外部服务集成设计](service-integrations.md)，通用 HTTP 规则见 [API 设计](api.md)。本页所有路径均相对 `/api/v1`，仅入站接收免登录会话和 CSRF。

## 1. 通用协议与条件写入

- JSON 字段 snake_case；成功 `{"data":...}`，204 无体；错误沿用 error.code/message/details 和 request_id。拒绝未知字段、只读字段及不支持的类型/认证方式，不静默忽略。
- ID 为无前导零的正十进制字符串，时间 UTC RFC3339 毫秒精度；expires_at 可为 null。内部整数版本不作为并发令牌裸露，API 的 version/mutation_version 是不透明字符串。
- 管理 API 使用 Cookie/CSRF；所有 GET/响应，包括诊断和一次性秘密，Cache-Control: no-store。常规 JSON 请求最多 64 KiB；Webhook 入站最多 1 MiB。
- 强 ETag 通过 If-Match 提交，拒绝弱标签和 `*`；缺失返回 428 PRECONDITION_REQUIRED，格式错误 422 VALIDATION_FAILED，过期 412 VERSION_CONFLICT。授权先于版本检查，不能借冲突探测他人资源。
- ETag 与 body.version 为同一令牌（ETag 增加双引号）；集合的 mutation_version 同理。令牌按表示类型/版本、资源 ID、归属主体及内部版本生成带服务端密钥的摘要，不公开其他归属 ID、数量或计数器。不同表示有独立标签命名空间。
- 普通 PATCH 省略字段表示保持；description="" 表示清空；config.custom_ca_pem=null 表示移除 CA；expires_at=null 表示移除有效期。其他必填字段不接受 null。PATCH 的 config 对象按已知字段合并，数组整体替换，不是任意 JSON Patch。
- 连接/凭证 code 均不可编辑，创建时省略或空白生成无短横线 UUID v4；手动值去首尾空白后匹配 `[a-z0-9][a-z0-9_-]{0,63}`。名称 1–100 字符，说明最多 1000 字符。
- 列表首版完整返回 `{items}` 或 `{items,mutation_version}`，按 name、id 排序，由前端筛选；不接受分页/搜索参数，也不返回动态可用性或诊断。目录/集合不附带其他归属数据。
- 创建连接不要求版本；创建凭证要求集合 If-Match，空集合也有 ETag。凭证删除使用对象 If-Match，加 `X-Collection-If-Match` 提交所属集合 ETag，两者均须最新；该自定义头只用于文档明确要求的删除操作。
- 对象 PATCH、认证/验证替换、验证命令用对象 ETag；首选资源、兜底资源分别先 GET 再用其 ETag 写入。POST 测试/验证也必须带版本，防止验证已被修改的配置。
- 无变化命令返回当前资源和原版本。任何名称/code 唯一冲突为 409；不返回冲突归属或秘密。网络写操作没有自动安全重试承诺，创建响应丢失先重新列举；一次性生成响应丢失需重新加载版本再生成。

## 2. 类型与有限目录

| 方法/路径 | 响应 | 权限 |
| --- | --- | --- |
| GET /service-types | `{items:[ServiceType]}` | 正常登录 |
| GET /service-connections | `{items:[ConnectionSummary]}` | 正常登录 |

ServiceType 由代码注册，示例为 GitLab 适配器完成后可发布的能力：

```json
{
  "service_type": "gitlab",
  "name": "GitLab",
  "credentials": true,
  "connection_test": true,
  "credential_verification": true,
  "auth_methods": ["gitlab_access_token"],
  "webhook": {
    "supported": true,
    "verification_methods": ["secret_token", "signing_token"]
  },
  "operations": []
}
```

operations 只列真实实现且可用的适配器操作，本轮维护接口不虚构执行能力。类型能力不是调用授权。未实现的 Jenkins/MySQL/日志类型不发布，钉钉机器人属于未来通知模块，不在此目录。

ConnectionSummary 精确投影为 id、code、service_type、name、description、enabled；不包含地址、CA、创建者、凭证计数/名称、兜底、Webhook 设置或编辑版本。普通用户不提供配置详情接口。目录可包含已停用连接，便于维护已有凭证。

## 3. 服务连接

维护路由带服务类型，创建体不接受 service_type。以下 `C=/admin/service-connections/gitlab`，`c` 为 connection_id；未来服务采用对应类型路径及 DTO。所有请求核对父子归属及类型，不匹配统一 404。数据库扩展缺失/错配是 500 DATA_INTEGRITY_ERROR，不当作未配置。

| 方法/路径 | 请求 | 响应/前置条件 |
| --- | --- | --- |
| GET C | 无 | 200 `{items:[ConnectionSummary]}` |
| POST C | ConnectionCreate | 201 Connection、Location、ETag；无前置版本 |
| GET C/{c} | 无 | 200 Connection、ETag |
| PATCH C/{c} | name/description/enabled/config 的任意非空子集 | 200 Connection、新 ETag；If-Match |
| DELETE C/{c} | 无 | 204；If-Match，全部凭证必须为空；Webhook 设置随连接删除 |
| POST C/{c}/test | `{}` | 200 Diagnostic；连接 If-Match、连接启用 |
| GET C/{c}/diagnostics | 无 | 200 `{latest:Diagnostic或null}`，无 ETag |
| GET C/{c}/fallback-credential | 无 | 200 CredentialSelection、独立 ETag |
| PUT C/{c}/fallback-credential | `{credential_id}` | 200 CredentialSelection、新 ETag；兜底 If-Match |
| DELETE C/{c}/fallback-credential | 无 | 204、新 ETag；兜底 If-Match |

这些接口仅系统管理员可用。ConnectionCreate：

```json
{
  "code": "company-gitlab",
  "name": "公司代码平台",
  "description": "研发使用",
  "enabled": true,
  "config": {
    "base_url": "https://gitlab.example.com",
    "custom_ca_pem": null
  }
}
```

name/config/base_url 必填；description 缺省空字符串，enabled 缺省 true，custom_ca_pem 缺省 null。base_url 最长 2048 字符，CA 最多 16 KiB，其余 URL/TLS 校验见领域设计。创建同时写主表与正确扩展，失败全部回滚。

Connection 返回字段：id、code、service_type、name、description、enabled、config、version、created_at、updated_at。config 与上述 GitLab 配置同形。不包含子列表、诊断、兜底或内部版本。服务配置与公共资料共用一个聚合 ETag，可一次 PATCH 原子提交；不再提供旧的独立 `/config` 资源和第二份编辑版本。只修改 config 中实际变化的访问字段才递增内部 config_version。

CredentialSelection 为 `{credential_id:null或ID字符串, version:不透明字符串}`。兜底只接受同连接的系统凭证，且启用、材料完整、未已知过期。无身份验证成功的先决要求；不返回名称/可用状态，避免依赖凭证修改或时间推移的表示变化。连接停用时仍能维护兜底。

## 4. 访问凭证与首选

三种集合根路径 P，归属由路径和登录主体确定，请求体不能提供 ownership_type/project_id/user_id/connection_id/service_type：

| 归属 | P | 权限 |
| --- | --- | --- |
| 系统 | /admin/service-connections/gitlab/{c}/credentials | 系统管理员 |
| 项目 | /projects/{project_id}/service-connections/gitlab/{c}/credentials | 项目管理员或系统管理员 |
| 个人 | /me/service-connections/gitlab/{c}/credentials | 本人，无代管入口 |

| 方法/路径 | 请求 | 响应/条件 |
| --- | --- | --- |
| GET P | 无 | 200 `{items:[Credential],mutation_version}`、集合 ETag |
| POST P | CredentialCreate | 201 Credential、Location、对象 ETag；集合 If-Match；响应另带 X-Collection-ETag |
| GET P/{credential_id} | 无 | 200 Credential、对象 ETag |
| PATCH P/{credential_id} | name/description/enabled/expires_at 的非空子集 | 200 Credential、ETag、X-Collection-ETag；对象 If-Match |
| DELETE P/{credential_id} | 无 | 204、X-Collection-ETag；对象 If-Match + X-Collection-If-Match |
| PUT P/{credential_id}/authentication | Authentication | 200 Credential、ETag、X-Collection-ETag；对象 If-Match |
| POST P/{credential_id}/verify | `{}` | 200 Diagnostic；对象 If-Match，父连接和凭证均可用 |
| GET P/{credential_id}/diagnostics | 无 | 200 `{latest:Diagnostic或null}`，无 ETag |
| GET P/preferred | 无 | 200 CredentialSelection、首选资源 ETag |
| PUT P/preferred | `{credential_id}` | 200 CredentialSelection、新 ETag、X-Collection-ETag；首选 If-Match |
| DELETE P/preferred | 无 | 204、新 ETag、X-Collection-ETag；首选 If-Match |

X-Collection-ETag 返回写后集合的带引号强标签，与下一次 GET P 的 mutation_version 对应。首选资源版本由同归属标识和内部 credentials_version 派生，故普通凭证编辑也可能使首选 ETag 失效；与集合 ETag 使用不同表示命名空间，不能互换。静态 preferred 路由优先，资源 ID 限制数字。

CredentialCreate 示例：

```json
{
  "code": "project-gitlab-bot",
  "name": "项目机器人",
  "description": "开发操作",
  "authentication": {
    "auth_method": "gitlab_access_token",
    "identity_config": {},
    "secret": {"token": "<输入的访问令牌>"}
  },
  "expires_at": null
}
```

name/authentication 必填；description 缺省空，expires_at 缺省 null；创建固定 enabled=true、is_preferred=false，不接受客户端覆盖。Authentication 即示例 authentication 对象，PUT 要求三个字段完整提交；不允许 PATCH 一部分身份而隐式沿用旧秘密。secret 的内容与方式必须匹配，GitLab token 非空；拒绝 auth_schema_version、密文和 key_version 输入。

Credential 的非秘密输出：id、connection_id、service_type、code、ownership_type、project_id、user_id、name、description、auth_method、identity_config、has_secret、enabled、is_preferred、expires_at、version、created_at、updated_at。不存在的主体字段为 null；has_secret 由密文存在性派生，不返回 Token 长度、前后缀或密文。

is_preferred 只能通过首选命令修改；切换首选事务内清旧、设新，更新两份凭证的对象版本/更新时间和集合版本。普通编辑、认证替换也使集合令牌变化。兜底标记不混入凭证 DTO，管理员从兜底资源关联 ID 展示。

删除或停用当前兜底凭证同时清除引用并递增 fallback_version；不要求调用者提供额外兜底 ETag，这是凭证维护的原子不变量。自然过期保留标记、拒绝新设首选/兜底。项目归档时 GET 可读，所有写入/verify 返回 409 PROJECT_ARCHIVED。不能以管理员身份读取其他人的个人凭证。

## 5. Webhook 接收设置

仅系统管理员可维护。单例资源 `W=/admin/service-connections/gitlab/{c}/webhook` 随连接存在，没有创建、列表、删除或接入点 ID 路由。

| 方法/路径 | 请求 | 响应/条件 |
| --- | --- | --- |
| GET W | 无 | 200 WebhookSettings、独立 ETag |
| PATCH W | `{enabled}` | 200 WebhookSettings、ETag；Webhook If-Match |
| PUT W/verification | `{verification_method,secret:{token}}` | 200 WebhookSettings、ETag；Webhook If-Match |
| POST W/verification/generate | `{}` | 200 `{webhook:WebhookSettings,secret:{token}}`、ETag；Webhook If-Match |
| GET W/receiver | 无 | 200 `{receive_url}`，无 ETag |
| GET W/diagnostics | 无 | 200 `{latest:Diagnostic或null}`，无 ETag |

WebhookSettings 初始响应示例：

```json
{
  "connection_id": "12",
  "enabled": false,
  "verification_method": "secret_token",
  "has_secret": false,
  "version": "<不透明版本令牌>",
  "updated_at": null
}
```

修改后 updated_at 为 UTC RFC3339 毫秒时间。无独立 id、code、名称、说明、config 或集合版本，不返回 X-Collection-ETag。拒绝未知字段和空 PATCH，enabled=null 非法。事件筛选及项目绑定由消费方配置。

验证方式只能与秘密一起 PUT verification；secret_token/signing_token 都使用 secret.token，由适配器验证格式。generate 固定切换到 secret_token 并生成高熵 Token，保留接收开关；只在该响应展示明文一次。启用必须已配置合法秘密，否则 422 SECRET_REQUIRED。关闭保留秘密和方式，无单独删除设置接口。

receive_url 从可信部署访问地址构造为 `/api/v1/webhooks/gitlab/{connection_id}`，不受外部 GitLab 地址变化影响。使用独立只读资源避免部署访问地址变化污染编辑 ETag。多个远端 Hook 共用此连接的地址和秘密，轮换须同步更新；其他连接不受影响。父连接停用时仍可维护设置，但不能接收。

Webhook 修改只递增 webhook_version，连接地址/CA 修改只影响连接编辑版本；两者在同一父连接锁下更新各自字段，不互相覆盖。接收诊断不改变编辑版本和更新时间。连接删除同时移除设置、秘密和诊断，使接收地址失效。

## 6. 验证与诊断 DTO

Diagnostic 示例（已保存且快照仍当前的凭证验证）：

```json
{
  "id": "d98b4c10d7514eb7b5a2bcb55dce4b71",
  "kind": "credential_verification",
  "started_at": "2026-10-29T08:00:00.000Z",
  "finished_at": "2026-10-29T08:00:00.120Z",
  "status": "succeeded",
  "outdated": false,
  "summary": {"authentication": "valid", "permissions": "unknown"}
}
```

kind 为 connection_check / credential_verification / webhook_receipt。入站的 started_at 为服务器收到请求的时间（即领域设计中的 received_at），finished_at 为接收验证完成时间，不另返回第二个同义时间字段。出站 status 为 succeeded/failed/unsupported；入站为 received_not_dispatched。summary 是各 kind 的白名单 DTO：连接仅 reachability 和 reason；凭证可含 authentication、permissions、经过白名单筛选的 external_identity、可获取的 remote_expires_at、reason；入站仅 event_type（原始 X-Gitlab-Event 值）、可选 source_project_id、delivery_id。身份仅向凭证维护者返回，远端有效期未知为 null，不反向覆盖人工 expires_at。

远端网络/TLS/认证失败作为 200 Diagnostic(status=failed) 返回并保存白名单结果；本地授权/状态/版本/限流/保存失败使用相应 HTTP 错误，不伪装远端验证失败。测试只使用保存后的配置；GitLab 连接测试检查受控健康地址，凭证验证调用只读身份接口，不保证特定业务权限。后续服务没有无副作用的认证检查时声明 credential_verification=false，不能触发真实构建等操作作为隐式验证。

诊断 GET 没有记录返回 latest=null；版本变化通过 outdated=true 表达，内部快照计数器不返回。POST 返回本次结果；只有该结果仍满足版本/权限条件才保存，同版本并发可能因更晚的结果已保存而不替换最新摘要。诊断不写入编辑/集合 DTO，不递增它们的版本。

## 7. 入站接收

`POST /webhooks/gitlab/{connection_id}` 无浏览器 Cookie/CSRF，不能免除 Token/签名认证。具体认证与格式校验顺序和 1 MiB 上限见[领域设计](service-integrations.md#7-gitlab-接收契约)。不提供任意工作流触发参数。

```json
{"data":{"status":"received_not_dispatched"}}
```

认证通过后，要求请求体是 JSON 对象，并且恰好一个非空 X-Gitlab-Event 头（最长 128 字节）。不限制事件类型枚举，不要求项目 ID 或事件业务字段；已有及未来 GitLab 事件均可接收。source_project_id 只在正文含有效 project.id 时作为诊断摘要提取，不影响接收。成功返回 200，不返回 payload、秘密或凭证引用，不承诺可靠入队、幂等执行或工作流触发。重复接收只允许重复更新诊断。

## 8. 错误清单与实施边界

| HTTP | error.code | 含义 |
| --- | --- | --- |
| 400 | BAD_REQUEST | JSON 解析或请求格式错误 |
| 401 | UNAUTHENTICATED / WEBHOOK_AUTHENTICATION_FAILED | 会话或入站认证失败 |
| 403 | FORBIDDEN | 已登录但无对应管理权限 |
| 404 | NOT_FOUND | 资源不存在、父子/类型/归属不匹配；入站停用也为 404 |
| 409 | CONNECTION_CODE_CONFLICT / CREDENTIAL_CODE_CONFLICT | code 冲突，details.field=code |
| 409 | NAME_CONFLICT | 对应唯一域名称冲突，details.field=name |
| 409 | CONNECTION_NOT_EMPTY | 有任何凭证，不能删除；不透露其他归属内容 |
| 409 | RESOURCE_DISABLED / CREDENTIAL_UNAVAILABLE / PROJECT_ARCHIVED | 当前生命周期不允许操作 |
| 409 | STATE_CHANGED | 外部调用期间配置/材料/状态发生变化 |
| 412 | VERSION_CONFLICT | 条件请求过期 |
| 413 / 415 | PAYLOAD_TOO_LARGE / UNSUPPORTED_MEDIA_TYPE | 入口限制 |
| 422 | VALIDATION_FAILED / SECRET_REQUIRED | 字段/条件头格式或秘密错误 |
| 428 | PRECONDITION_REQUIRED | 缺少必须的条件头 |
| 429 | RATE_LIMITED | 附 Retry-After，不泄漏认证材料 |
| 500 | DATA_INTEGRITY_ERROR | 类型扩展/引用损坏，受控错误，禁止执行兜底 |
| 503 | SERVICE_UNAVAILABLE | 临时存储不可用等基础设施错误 |

403 用于缺少角色等请求级授权；目标属于其他个人/项目归属、路径父子不匹配统一 404，避免枚举。具体字段错误用 error.details 数组，引用通用错误协议，不返回数据库约束名、远端正文、认证身份或输入秘密。

不保留旧 `/integrations`、`/default-credential`、内嵌 `/webhook-secret`、独立 `/config` 或旧 webhook 地址别名。运行路由、合并后的迁移 5 与正式前端已采用本契约，三表、归属隔离、版本/锁、诊断和连接内 Webhook 设置已加入回归验证，具体范围见[开发说明](development.md)。此文不是已发布 OpenAPI 描述，后续以实现 DTO 生成 OpenAPI 并与本文核对。

GitLab `config.base_url` 支持 HTTP、HTTPS、自定义端口和子路径，禁止 userinfo/query/fragment；非法协议返回字段原因 `http_url_required`。HTTP 不使用 TLS，已有公共 CA 配置保留供切回 HTTPS 使用；现有目标地址限制不变。
