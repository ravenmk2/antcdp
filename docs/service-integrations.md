# 外部服务集成设计

更新日期：2026-10-28。状态：已实现，进入验收与部署。采用 `integration`、`integration_gitlab`、`integration_credential` 三张表，取代此前四表草案及专属配置放入公共主表的两表方案。DDL 阅读副本见 [schema.sql](schema.sql)；运行迁移为 `00003_integrations.sql`，通过真实 MySQL 新装及版本 2 → 3 升级验证。

## 1. 目标、术语与范围

AntCDP 接入外部服务，供后续 AI Agent 工具和工作流使用。本期实现 GitLab 集成管理、系统/项目/个人凭证维护，以及 Webhook 配置与接收验证；不实现 Agent 工具执行、凭证选择链、运行时 fallback、工作流触发或外部仓库绑定。

计划扩展 GitLab、RabbitMQ、Redis、Elasticsearch（ES）、OpenObserve、Jenkins、PostgreSQL、MySQL、MongoDB、Nacos。未实现的服务不注册为可创建类型，不建立空页面或驱动。

- **集成 integration**：AntCDP 与一个外部服务之间的接入配置，可同时包含对外访问与入站事件能力。
- **连接 connection**：集成中的访问参数或“测试连接”操作；不再作为核心表名。
- **实例 instance**：外部系统实际部署，作为“GitLab 实例地址”等说明用语；同一实例可以因用途不同创建多项集成。
- **凭证 credential**：用于对外访问的具名认证身份及秘密。Webhook 验证秘密属于集成配置，不是 API 凭证。
- **首选 preferred**：同一集成、同一归属主体内优先采用的凭证。
- **默认 default**：集成指定的一份系统级凭证，供后续凭证缺失时 fallback；不是第四种归属。

## 2. 已确认方向与本稿建议的界限

已确认方向：

1. 每种服务支持多项集成。系统管理员维护集成与系统级凭证；项目管理员和系统管理员维护项目级凭证；本人维护个人凭证。
2. 项目指 AntCDP 项目；不设团队级凭证。本期不做系统凭证对项目、团队、个人的使用授权。
3. 系统凭证可用于平台在自身业务授权通过后的代执行，不要求授权给操作人。凭证使用权不等于读取秘密的权限。
4. 同一集成、同一归属支持多份凭证和首选设置；每项集成可以指定一份系统级默认凭证。
5. 默认仅表达缺失时的 fallback；认证失败、过期或权限不足不自动视为缺失。具体选择流程留待执行设计。
6. 采用统一集成/凭证模型、服务专属维护接口和参数；通用权限、加密、审计与并发实现复用。
7. 秘密直接加密存于所属记录，不另设一对一秘密表；凭证直接保存归属与首选标记，不设集合表。
8. GitLab Webhook 属于本期，配置归属于集成，一项集成共用一套入站验证配置；API 凭证与入站验证秘密互不回退。
9. 不实现工作流执行，但接收验证必须有可验收的完整闭环。
10. 集成三表不设置物理外键和 CHECK，保留主键、唯一键、查询索引及基础字段类型、可空性与默认值。关联完整性与业务规则由代码和事务保证；既有业务表不在本次调整范围。
11. 公共主表只保存公共管理字段；服务专属配置进入一对一扩展表，本期仅建立 integration_gitlab。凭证保持通用表，后续服务接入时再增加相应扩展表。

实施采用下述边界；第 12 节记录本期实现选择与尚未覆盖的外部联调范围。

## 3. 参考项目与取舍依据

| 参考 | 可借鉴内容 | 不直接照搬的部分 |
| --- | --- | --- |
| GitLab Integration | 统一字段机制、按服务提供维护 API | GitLab 按项目/群组组织的集成不等于本系统三类凭证 |
| Backstage | integrations 下按服务配置多项接入，instance 描述实际外部部署 | 静态配置中的 Token 不替代本系统凭证管理 |
| Jenkins GitLab Plugin | 明确区分对外 API 连接与入站触发认证 | 按 Job 配置 Token 不要求本系统也按工作流配置 |
| Argo Events | 同一 GitLab 事件源含 accessToken 与 secretToken，二者用途独立 | Kubernetes Secret 与控制器生命周期不是本项目存储模型 |
| n8n 凭证实体 | 凭证实体内保存认证数据，入库前加密 | 不复制其共享、动态解析及权限模型 |

官方资料：[GitLab 开发指南](https://docs.gitlab.com/development/integrations/)、[GitLab 集成 API](https://docs.gitlab.com/api/v1/project_integrations/)、[Backstage GitLab](https://backstage.io/docs/integrations/gitlab/locations/)、[Jenkins GitLab Plugin](https://github.com/jenkinsci/gitlab-plugin)、[Argo GitLab 示例](https://github.com/argoproj/argo-events/blob/master/examples/event-sources/gitlab.yaml)、[n8n 凭证实体](https://github.com/n8n-io/n8n/blob/master/packages/@n8n/db/src/entities/credentials-entity.ts)、[n8n 加密说明](https://github.com/n8n-io/n8n-docs/blob/main/docs/deploy/host-n8n/configure-n8n/basic-configuration/configuration-examples/set-a-custom-encryption-key.md)。

这些参考证明方案可行，不构成三表模型或首选策略的行业统一标准。

## 4. 多服务扩展与字段分类

业务模块 integrations 定义通用模型、维护用例和仓储接口；服务适配器声明服务标识、配置版本、认证方式、非敏感/敏感字段、校验及验证能力。MySQL 适配器负责持久化和事务。前端按服务提供专属表单。

采用代码注册与类型化结构，不使用自由 JSON 编辑器、任意认证头或运行时插件加载器。专属表中的稳定字段使用明确列，节点列表和诊断摘要等可以使用类型受控的 JSON。未知字段、认证方式及材料版本均拒绝写入。公共列表只查 integration；服务详情通过类型对应的扩展仓储读取，不关联所有服务扩展表。

| 服务 | 集成配置示例 | 凭证非秘密字段示例 | 秘密字段示例 |
| --- | --- | --- | --- |
| GitLab | 基础 URL、TLS、Webhook 启停和验证方式 | 令牌类别说明、验证所得账号摘要 | API Token；集成另存 Webhook 验证秘密 |
| RabbitMQ | 管理 API、消息协议端点、TLS | 用户名 | 密码 |
| Redis | 单节点/集群/Sentinel 模式、节点列表 | ACL 用户名等 | 密码、必要时独立 Sentinel 认证材料 |
| Elasticsearch | 节点列表、TLS | 用户名或密钥标识 | 密码或 API Key |
| OpenObserve | API 地址、TLS | 用户名等 | 密码或所支持的令牌 |
| Jenkins | 基础 URL、TLS | 用户名 | API Token |
| PostgreSQL / MySQL | 主机、端口、TLS；适配器允许时多节点 | 用户名 | 密码或客户端私钥 |
| MongoDB | 节点、连接模式、TLS | 用户名、认证库、认证机制 | 密码或客户端私钥 |
| Nacos | 服务地址与服务专属上下文 | 用户名等 | 密码或访问密钥 |

以上仅是建模示例，非已支持功能清单。数据库、vhost、索引、组织、命名空间等上下文由适配器定义，不统一提升为公共列，也不等价于授权范围。不能直接将带密码的 DSN、URI、userinfo 或 query 参数保存到非敏感 config。

## 5. 三表模型与 DDL 对照

表名采用单数，ID 为 BIGINT UNSIGNED，时间为 UTC DATETIME(3)，API ID/版本均为十进制字符串。schema.sql 包含一期 7 张、协作 9 张、集成迁移 3 张，共 19 张目标业务表。

### 5.1 integration

| 字段 | 职责 |
| --- | --- |
| id、service_type | 稳定身份、代码注册的服务类型；类型不可修改 |
| name、description | 名称与纯文本说明 |
| enabled | 整项集成的管理启停状态 |
| default_credential_id | 同一集成内系统级默认凭证，可空 |
| row_version | 公共资料与整项启停的编辑版本 |
| credentials_version | 该集成下凭证列表内容变化的并发版本；私有内部值 |
| default_version | 默认设置的独立并发版本 |
| created_by_user_id、created_at、updated_at | 溯源与编辑时间 |

UNIQUE(service_type, name)，名称大小写不敏感、重音敏感。公共主表不含服务配置 JSON、秘密、测试摘要或 Webhook 专属字段。

default_credential_id 是逻辑引用，不设物理外键；代码在事务内检查目标存在、属于同一集成、为系统级、启用且未已知过期。保留 default_credential_id 查询索引用于反查引用。默认、首选均不自动选第一份。

### 5.2 integration_gitlab

| 字段 | 职责 |
| --- | --- |
| integration_id | 主键，一对一逻辑关联 integration.id，无物理外键 |
| base_url、custom_ca_pem | GitLab 基础地址与可选公共 CA；默认严格 TLS 验证 |
| webhook_enabled、webhook_verification_method | 入站子开关与显式验证方式 |
| webhook_secret_ciphertext、secret_format_version、secret_key_version | 加密验证秘密及封装版本；三字段同时为空或完整由代码校验 |
| row_version | GitLab 配置、秘密及子开关的编辑版本 |
| connection_version | 地址/CA 等影响对外访问配置的版本 |
| webhook_version | 入站配置和秘密版本 |
| last_connection_check、last_webhook_receipt | 白名单诊断摘要，分别绑定连接/入站版本，不是事件队列 |
| created_at、updated_at | 配置创建和编辑时间；诊断更新不改变编辑版本 |

地址不唯一。主表和扩展记录在同一事务创建/删除；代码保证 service_type=gitlab 时恰好一条对应记录，不允许为其他类型创建 GitLab 扩展。主表类型不可变；扩展缺失或不匹配返回数据完整性错误，不当作未配置。两表各自保存编辑版本，诊断和网络调用不持数据库锁等待。服务扩展列随版本化迁移演进，不再保留 config_schema_version/config 万能字段。

### 5.3 integration_credential

| 字段 | 职责 |
| --- | --- |
| id、integration_id | 稳定凭证 ID 和所属集成，创建后不迁移 |
| scope_type、project_id、user_id | system / project / personal 及归属主体的逻辑引用 |
| owner_key | 生成列：系统为 0，否则对应项目或用户 ID，仅用于唯一约束 |
| name、description | 具名认证身份 |
| auth_method、auth_schema_version、identity_config | 服务支持的认证方式与非秘密身份信息 |
| secret_ciphertext、secret_format_version、secret_key_version | 凭证自身的加密秘密，不引用其他凭证 |
| enabled、is_preferred | 启停与首选标记 |
| preferred_slot | 生成列：首选为 1，非首选为 NULL |
| expires_at | 可选的人工维护过期时间 |
| row_version、material_version | 编辑版本、身份/秘密材料版本 |
| last_verification | 最近验证摘要：验证时间、两类版本、结果、可获取的外部身份及远端有效期 |
| created_by_user_id、created_at、updated_at | 溯源；创建者不作为所有权依据 |

代码严格校验归属组合：system 两个主体 ID 都空；project 仅 project_id 有值；personal 仅 user_id 有值。事务内检查对应项目、用户和集成存在及可用，不设置物理外键。owner_key 只辅助唯一索引，不代替关联和归属校验；非法 scope 或主体缺失必须在写入前拒绝，不能依赖生成列兜底。

唯一约束：

- (integration_id, scope_type, owner_key, name)：同一归属内名称唯一。
- (integration_id, scope_type, owner_key, preferred_slot)：同一归属最多一份首选；MySQL 允许多行 NULL，故非首选可有多份。

代码保证 is_preferred 只能用于 enabled 凭证。自然过期按当前时间判断：展示不可用，禁止新设为首选/默认；既有设置保留告警，不定时重选。GitLab API Token 必填由适配器校验；未来显式支持无秘密的认证方式时，允许 secret 三字段同时为空。

### 5.4 去掉集合表后的并发取舍

所有凭证写事务先锁归属授权相关对象，再锁 integration 行，最后锁凭证；在同一集成内串行化维护。首期维护操作频率低，接受不同归属的操作短暂排队，不在远程请求期间持锁。

credentials_version 在新增、删除、首选、资料、启停、秘密状态及验证摘要等列表展示内容变化时递增。集合读取返回不透明的强 ETag，由集成 ID、归属类型/主体 ID、查询参数、表示版本和该版本固定编码摘要产生；不公开其他归属的 ID、数量或版本值。列表不混入未经纳入版本的主表字段或当前时间：返回有效期时间点，由前端计算到期展示，写入资格仍由服务端实时检查。同一集成不同归属的列表变化可能使旧表单发生 412，这是不设集合表的明确代价。以后若真实争用明显，再引入归属级状态行。

切换首选使用未筛选集合的 ETag：锁内验证、先清旧标记、后设新标记、递增版本、审计，同事务提交。唯一索引是最终防线。版本避免“改走又改回来”绕过旧请求。普通编辑用凭证编辑版本进行条件更新，但提交后同样使集合版本失效；列表筛选响应另提供未筛选集合的 mutation_version，用于新增、删除、首选命令。

创建、删除或停用导致首选变化时同步集合版本；删除还校验凭证版本。默认变更单独使用 default_version。默认凭证删除/停用时原子清除引用并递增默认版本。

配置/凭证的编辑 ETag 仅用于其可编辑资源表示。连接测试、Webhook 接收和凭证验证摘要通过独立只读 diagnostics 子资源返回，不混入同一个编辑 ETag 的表示。验证接口返回新的诊断结果与集合 mutation_version；诊断 GET 使用 no-store，本期不提供条件缓存。默认资源只返回 credential_id 与 default_version，不包含随凭证编辑变化的名称；名称由凭证列表解析。

### 5.5 加密、更新和删除

沿用主密钥、独立用途派生与 AES-256-GCM。集成秘密和凭证秘密使用不同用途标识，AAD 绑定安装 ID、资源 ID、service_type、材料用途和结构版本。每次加密使用新的随机 nonce；同表或跨表交换密文必须解密失败。

先取得新记录 ID，再在同一事务内完成最终加密写入；临时占位不得提交。普通查询显式列出非秘密字段，禁用 SELECT * 映射到公开 DTO。解密仅通过内部受控方法，HTTP 无秘密读取 API。格式和 key_version 保留演进，不表示已有自动密钥轮换或 KMS。

修改普通资料不接收秘密；独立替换命令要求完整敏感结构，省略、空值、星号占位均不能隐式覆盖。替换保持资源 ID，凭证首选/默认不变，material_version 递增。删除凭证先清默认引用，再删记录；无秘密孤儿清理任务。项目/系统凭证保留创建者墓碑引用。备份恢复仍依赖原主密钥，在线删除不承诺擦除历史备份。

## 6. 权限、可见范围与生命周期建议

| 能力 | 权限 |
| --- | --- |
| 集成、系统凭证、系统首选、默认、Webhook 配置 | 系统管理员 |
| 项目凭证与项目首选 | 对应项目管理员、系统管理员 |
| 个人凭证与个人首选 | 本人；系统管理员不能代管他人 |
| 集成公开目录 | 正常登录用户，仅 ID、类型、名称、说明、启停状态 |
| 外部验证 | 具备对应维护权限；归档项目不能验证 |
| 秘密读取 | 无保存后的读取/复制/导出接口 |
| Webhook 接收 | 无登录会话，按入站验证方式认证，不走浏览器 Cookie/CSRF |

团队管理员不自动获得项目管理权限。普通项目成员不看到项目凭证管理数据。非秘密身份信息也只向维护者返回。个人或项目凭证测试不能修改集成地址、协议或请求路径。

整项集成停用后对外测试和入站接收不可用，配置和凭证仍可维护；Webhook 子开关独立于整项开关，任一关闭均不接受事件。凭证停用清除首选/默认，启用不自动恢复。删除集成要求无任何凭证，提示接收地址随之失效；无永久接收事件记录需级联。

项目归档后项目凭证只读；恢复后可维护。创建者退出或被删除不影响项目凭证。禁用账号保留个人凭证但无法访问；删除账号与清除其个人凭证同事务完成。系统管理员不可用普通个人凭证接口列出或解密他人秘密。

## 7. GitLab 首期配置及 API 验证

服务类型 gitlab，首期认证方式 gitlab_access_token，支持手动输入访问令牌；不根据 Token 前缀猜测账号、类型或权限。个人/项目/群组令牌类型与 AntCDP 凭证归属无一一对应关系，参考[GitLab REST 认证](https://docs.gitlab.com/api/v1/rest/authentication/)。

GitLab 专属接口的非秘密配置 DTO 示例（字段映射到 integration_gitlab 列，不作为整体 JSON 入库）：

```json
{
  "base_url": "https://gitlab.example.com",
  "custom_ca_pem": null,
  "webhook_enabled": false,
  "webhook_verification_method": "secret_token",
  "has_secret": false
}
```

Webhook 替换请求为 `{verification_method, token}`，凭证创建的 secret 为 `{token}`，凭证替换请求为 `{token}`。本期封装版本 1 加密保存单个 Token 字符串，分别存于扩展表与凭证表，二者用途不同。TLS verify=true 是接口固定要求，不设可关闭的数据库列。验证方式变更必须与秘密替换在同一命令完成，不把旧字节重新解释为新方式。

基础 URL 允许合法子路径，禁止 userinfo、query、fragment；API 路径由服务端构造。默认 HTTPS、校验主机名，支持公共自定义 CA，不接收 CA 私钥，不提供跳过 TLS 验证开关。本期不开放 HTTP 和回环白名单；支持符合地址策略的内网 HTTPS。

测试集成只做连接探测，不暗用默认凭证；凭证验证使用已保存的对应 Token 和只读受控 API。网络/TLS 可达、认证有效、是否有特定业务权限必须分开表达。允许未验证或验证失败的配置保存；Token 权限和有效期无法获取时明确未知。

远程验证先授权取快照，在事务外发请求，再校验权限、生命周期、integration_gitlab.connection_version/credential.material_version 后保存白名单摘要。旧结果不覆盖新状态，不回传失去权限后的身份详情。验证结果更新不递增编辑版本。

网络操作限制协议、超时、响应大小、并发及重定向；不携带认证信息跨源跳转。允许业务内网，但不是任意网络代理：按管理员端点限制实际连接目标，拒绝云元数据与未指定地址，检查 DNS 解析和实际拨号一致性。建议总超时 10 秒、响应上限 1 MiB。

## 8. GitLab Webhook：本期接入闭环

### 8.1 验证方式与版本

GitLab 文档记录 Signing Token 在 19.0 引入、19.1 正式可用；推荐新 Hook 使用 HMAC-SHA256 签名。传统 Secret Token 通过 X-Gitlab-Token 传输共享秘密。参考[官方 Webhook 文档](https://docs.gitlab.com/user/project/integrations/webhooks/)。

本稿建议首期实现两种显式模式：

| 模式 | 配置及验证 |
| --- | --- |
| secret_token | 输入已有秘密或由 AntCDP 生成高熵秘密；与 X-Gitlab-Token 常量时间比较 |
| signing_token | 导入 GitLab 生成的 Signing Token；按其规范验证原始请求体、webhook-id、webhook-timestamp、webhook-signature |

签名模式按官方算法解码密钥、构造消息并验证多个签名候选；建议时间容差 ±5 分钟并限制头长度。不能先解析再序列化 JSON 后验签。配置了签名模式就不得在失败后改用传统 Token；不根据请求内容自动决定验证模式。最低 API 兼容版本仍待实际部署确认。

### 8.2 配置交互与轮换

系统管理员在 GitLab 集成详情查看接收地址、验证方式、配置状态及最近接收结果。建议地址 /api/v1/webhooks/gitlab/{integration_id}，ID 用于路由而非认证，不能只靠难猜 URL 保护。地址由已配置的 AntCDP 对外访问地址生成，不取任意 Host 头。

新生成的传统 Token 允许在创建结果中一次性展示并复制，用于粘贴到 GitLab；失败重试不能恢复明文，用户需重新生成或输入。已有秘密保存后不再读取。Signing Token 由 GitLab 生成后复制导入 AntCDP。输入值不存浏览器持久化存储，不写日志或审计。

一项集成的多个 Hook 共用秘密。替换会同时影响它们，必须提示同步修改所有 Hook；首期不提供双密钥过渡窗口。替换、方式变更、启停递增 webhook_version，旧最近接收结果不冒充新配置已验证。不自动创建、修改或撤销 GitLab 端 Hook。

创建集成时 Webhook 默认关闭；首次启用必须已保存与验证方式匹配的合法秘密，否则返回字段错误。关闭保留秘密以便恢复，生成/导入只保存秘密，不隐式启用接收。系统管理员完成 GitLab 端配置后显式启用。连接地址变化提示其影响全部 API 凭证；入站秘密仍独立，不随地址变化自动替换。

### 8.3 接收流程与响应语义

1. 仅允许 POST，按内容类型和流式读取上限限制请求（建议 1 MiB），先做入口限流；找不到集成或已停用不进入业务处理。
2. 根据已保存模式验证请求。未认证请求不得写入“最近成功接收”摘要或回显事件信息。
3. 校验 JSON 和事件头对应的事件结构，提取受限摘要。首期建议支持 Push Hook、Tag Push Hook、Merge Request Hook；其他合法已认证事件明确返回“不支持”，不虚构已处理。
4. 在短事务内重查 integration.enabled、Webhook 子开关和 webhook_version，拒绝使用已替换秘密的在途结果覆盖新状态。
5. 保存最近接收时间、事件类别、外部项目 ID、可用的投递标识、验证版本与结果；不保存完整 payload、认证头、提交内容或用户资料。
6. 成功返回 200 与明确状态 received_not_dispatched，表示“已验证接收，尚未分发工作流”。不是任务入队或执行成功承诺。

不存在/已停用建议返回 404，认证失败 401，格式错误 400，过大 413，不支持的事件 422，限流 429，持久化失败 503。限流错误不得使日志包含 Token。业务调用方不依赖 GitLab 是否读取响应体，AntCDP UI 必须显示“已验证接收，未触发工作流”。

只读诊断版本明确不承诺可靠投递、事件重放或工作流恰好执行一次。时间窗不能完全防止签名重放；重复投递可以重复更新摘要，但本期没有执行副作用。未来接入工作流必须增加持久事件收件箱、幂等键、来源映射与可靠分发后，才能把 2xx 解释成接受处理。现有三表不承担事件队列职责。

Token 证明发送方持有秘密，不证明 payload 中的项目归属。不能仅凭该秘密或 payload URL 触发任意 AntCDP 项目工作流、拉取任意地址或选择高权限凭证。

## 9. API 与前端组织

按服务暴露类型明确的 API，复用通用维护用例。维护路径已包含服务类型，GitLab 使用 /integrations/gitlab，未来 Redis 使用 /integrations/redis；不提供“修改 service_type”的接口。服务类型由路由决定，创建/修改请求体不接受 service_type。所有详情、凭证、测试和 Webhook 请求都检查路径类型与主表类型匹配，不匹配统一返回 404；扩展记录异常则返回受控数据完整性错误。以 GitLab 为例：

| 路由 | 用途 |
| --- | --- |
| GET /api/v1/integrations/types | 仅已实现的服务及认证/入站能力 |
| GET /api/v1/integrations | 有限目录投影 |
| /api/v1/admin/integrations/gitlab | GET 列表、POST 创建 |
| /api/v1/admin/integrations/gitlab/{id} | GET 公共资料、PATCH 名称/说明/整项启停、DELETE；使用主表 ETag |
| /api/v1/admin/integrations/gitlab/{id}/config | GET/PATCH GitLab 专属非秘密配置；使用扩展表 ETag |
| POST .../{id}/test | 测试已保存连接 |
| GET/PUT/DELETE .../{id}/default-credential | 读取/设置/清除默认，独立 ETag |
| GET .../{id}/diagnostics | 连接测试及最近 Webhook 诊断，no-store |
| PUT .../{id}/webhook-secret | 原子提交验证方式与匹配的新秘密；使用扩展表 ETag |
| POST .../{id}/webhook-secret/generate | 原子切换至传统 Token 并生成秘密，响应一次性明文；使用扩展表 ETag |
| /api/v1/admin/integrations/gitlab/{id}/credentials | 系统凭证集合 |
| /api/v1/projects/{project_id}/integrations/gitlab/{id}/credentials | 项目凭证集合 |
| /api/v1/me/integrations/gitlab/{id}/credentials | 本人凭证集合 |
| POST /api/v1/webhooks/gitlab/{id} | 无会话的入站验证端点 |

credentials 集合支持 GET/POST；/preferred 支持 PUT/DELETE；/{credential_id} 支持 GET/PATCH/DELETE；/{credential_id}/secret 支持 PUT 整体替换；/{credential_id}/verify 支持 POST。静态路由优先或 ID 路由限定数字，避免 preferred 歧义。启停通过对应 PATCH 明确字段，不允许批量覆盖归属。

/{credential_id}/diagnostics 支持 GET，只返回该凭证的脱敏验证摘要并使用 no-store；不得使用此接口探测其他归属凭证。

GitLab 集成创建一次提交公共资料与 GitLab 配置，主表/扩展原子落库。公共 GET/PATCH 不读写扩展配置，配置 GET/PATCH 不覆盖公共资料；PATCH /config 不允许单独改变验证方式，须用秘密替换命令。界面分别保存公共资料和服务配置，避免两个独立保存请求被误认为一个原子操作。删除使用主表 If-Match 及 expected_config_version（扩展 ETag），在锁内检查两者并原子删除两条记录。

GitLab 创建凭证 DTO 含 name、description、auth_method、identity_config、secret、expires_at；归属由路径确定，拒绝 client 提交 integration_id 覆盖、密文、生成列和他人归属。未来每种服务有自己的配置 DTO、校验和表单，不复制权限实现。GET /api/v1/integrations 和 /types 是跨类型目录/能力查询，允许不带类型路径；维护和入站路径必须明确类型。

沿用 Cookie/CSRF、字段 details、If-Match/412 和冲突/409。新建集成无需已有 ETag；凭证集合 GET 在空集合时仍给出 ETag，新增与首选命令要求它。普通凭证编辑和替换用凭证 ETag；删除用凭证 If-Match 加 expected_collection_version 不透明值。默认接口用独立默认 ETag；GitLab 配置和 Webhook 秘密使用扩展表 row_version 对应的 ETag，与主表编辑版本明确区分。

GET 不返回密文、私钥、Token 片段或内部 key_version，只返回 has_secret、配置状态和脱敏摘要。生成 Token 是唯一明确的一次性秘密响应例外，标记 Cache-Control: no-store。审计只记录发生生成/替换及版本，不记录响应。

页面按任务组织：控制台集成列表和 GitLab 详情（连接配置、系统凭证、Webhook），项目“集成”维护项目凭证，个人“集成凭证”维护本人凭证。首选标记与“缺失时回退”标记区分。Webhook 面板提供配置步骤、接收地址、验证方式、替换提示与最近结果，不暗示已开发工作流。

## 10. 事务、审计及存储边界

沿用用户→团队→项目的授权锁顺序，再按集成 ID 升序锁定公共主表、需要访问的对应服务扩展行，最后按凭证 ID 升序锁定凭证。扩展写入也先锁主表，防止配置写入与删除/停用交错。事务内重查有效成员、账号状态、项目归档、类型、归属和版本。账户删除先锁用户，再发现并排序锁定关联集成和凭证；个人凭证新增同样先锁用户，避免并发遗漏。

删除凭证原子清除默认引用；is_preferred 随记录删除并递增集合版本。删除集成锁定后重查所有归属的凭证，只有空集成可删除，扩展行与主表同事务删除。GitLab API Token 与集成 Webhook 秘密替换不相互修改版本；对外连接配置与入站配置分别维护扩展表 connection_version/webhook_version。公共整项启停只递增主表 row_version，网络结果回写还需比较采样时的主表版本，防止停用后再启用的旧在途结果落盘。

诊断摘要携带服务端开始/接收时间；同一配置版本的并发诊断回写按该时间比较，只保留较新的记录，避免慢请求覆盖较新结果。凭证验证摘要回写若改变列表展示需同步递增 credentials_version；不递增凭证编辑 row_version。

审计动作建议 integration.created/updated/enabled/disabled/deleted、integration.default_changed、integration.webhook_configured/secret_replaced，以及 integration.credential.created/updated/secret_replaced/enabled/disabled/deleted/preferred_changed。事件名称最终随 API 详细契约冻结。无变化操作不递增编辑版本和重复写审计。Webhook 高频接收只维护诊断摘要及限流的运行指标，不每次写业务审计。

集成三表与既有 user/project 表是逻辑关联，不设置物理外键或 CHECK，也没有后置 ALTER 外键语句。数据库保留主键、名称/首选唯一键和查询索引；基础字段类型、可空性与默认值保持明确。代码校验布尔、正版本号、归属组合、JSON 对象及字段结构、大小、秘密三字段完整性、认证方式与关联目标状态。所有写入口（包括后续导入、维护命令）必须复用这些规则，不只做前端表单校验。

关联检查与写入在同一事务按上述锁顺序执行；目标删除、账号清理与并发新增遵守相同锁协议，避免“检查时存在、提交时已删除”。删除集成前检查全部凭证，删除凭证前清默认引用，账号删除同步清理个人凭证；不能依赖数据库级联或 RESTRICT 拒绝。读取发现悬空引用时返回受控数据完整性错误，不将其当作凭证缺失触发 fallback。MySQL DDL 隐式提交，本文件不是原子迁移；已有业务表的外键和 CHECK 保持不变。

## 11. 实施与验收

实施顺序：审查本文及 DDL → 确定 GitLab 版本和接收边界 → 新增 goose 迁移与仓储端口 → 通用权限/加密/凭证 → GitLab 连接及 Webhook → 前端 → 实库和浏览器验收。不修改既有已发布迁移；本期新增第 3 版迁移。

重点验收：

- 多服务类型结构校验、多集成隔离、同归属名称唯一、凭证归属不可改。
- 服务类型路由匹配、请求体不得变更类型；主表/扩展创建删除原子性、缺失扩展报错；公共与扩展 ETag 独立，配置更新与删除/启停竞争正确。
- 数据库唯一键验证多份非首选可共存、只能一份首选、跨归属相同名称合法；服务层验证非法归属组合、缺失目标和跨集成默认引用被拒绝。
- 服务层覆盖非法布尔/版本、JSON 非对象、秘密字段不完整；并发目标删除与新增关联不得产生悬空引用，读取异常引用不执行 fallback。
- 过期/停用凭证设置、默认清除、并发首选切换和 ABA 旧请求；集合粒度冲突如约返回 412。
- 加密后落库、秘密字段不进普通查询/响应/日志、交换密文失败、替换和删除事务回滚、备份恢复。
- 管理员不能代管个人凭证；项目撤权/归档与旧请求、账号删除与新增凭证竞争。
- API 验证不持锁跨网络等待；过时结果不覆盖新状态；内网、子路径、CA、超时、DNS 与重定向边界。
- Webhook 两种验证方式、签名原始体、多个签名候选、时间窗、错误 Token、畸形/过大请求、模式降级被拒绝。
- 秘密替换/停用与在途 Webhook 竞争；生成只显示一次；多个 Hook 共用秘密的轮换提示。
- 支持事件和不支持事件响应、未认证请求不污染摘要；响应和页面明确未分发工作流。
- 深浅主题、键盘可用性、保存失败可修正、首选与默认语义清楚。

验证状态：Go 单元测试、真实 MySQL 新装/升级及 HTTP 集成测试通过。新增验收覆盖权限隔离、首选冲突、默认停用清除、密文落库、账号清理和 Token Webhook；签名、原始请求体、时间窗、禁止降级及网络地址策略有单元测试。用户实际 GitLab 实例与访问令牌尚未提供，不将模拟入站请求等同于外部 GitLab 端到端联调。

## 12. 本期实施边界与 API 补充

- HTTPS 必需，禁止回环、未指定、链路本地、云元数据及特殊地址；允许正常私有业务网络，支持自定义 CA。DNS 解析后校验全部地址并按已校验 IP 拨号，不使用系统代理，不跟随重定向。暂不提供 HTTP 或回环放行配置。
- API 使用 `/api/v1`；仅注册 `gitlab`。前端服务注册表定义连接字段、身份字段、秘密字段、认证方式和专属详情组件，能力目录只发布已实现的类型。
- 新建集成请求为 `{name, description, base_url, custom_ca_pem}`；公共 PATCH 仅接受 name/description/enabled；配置 PATCH 接受 base_url/custom_ca_pem/webhook_enabled，清空 CA 使用空字符串。TLS 始终验证，不接受 verify=false。
- 凭证认证方式为 gitlab_access_token；identity_config 是 `{token_type?: "personal" | "project" | "group"}`，仅为令牌类别说明。创建时提供，普通编辑限名称、说明、启停、到期时间；替换秘密独立提交。expires_at 使用 RFC3339 或 null。
- 集成目录和凭证集合首版返回完整列表，由前端搜索；尚无服务端分页和查询过滤。凭证集合返回 `{items, mutation_version}`，此版本绑定未筛选归属集合，不公开全局计数器。
- 公共资料、专属配置、凭证详情、默认资源通过响应 ETag 返回版本；PATCH/PUT/DELETE 使用 If-Match。公共 updated_at 只随公共版本变化，凭证或默认更新不会偷偷改变公共表示。诊断资源 no-store，历史配置对应的结果标记 outdated。
- Webhook 支持 Push Hook、Tag Push Hook、Merge Request Hook；请求体上限 1 MiB。传统秘密与 HMAC 签名显式二选一，签名时间窗 ±5 分钟，不降级。生成传统 Token 返回一次性 token，不隐式启用。签名 Token 从支持该功能的 GitLab 导入。
- 连接测试使用 `/-/health`，只判断 HTTP 可达；身份验证使用只读 `/api/v4/user`，仅确认身份，不保证具体业务权限，也不推断远端令牌有效期。网络超时 10 秒、响应上限 1 MiB、全局同时验证上限 8，并有入口限流。
- 本期尚无运行时凭证选择、fallback 执行、Agent 工具、工作流事件队列或分发；不承诺事件幂等执行、可靠重放或在线密钥轮换。

## 13. 关联文档

沿用[领域权限](domain-model.md)、[项目规则](projects-and-teams.md)、[API 基线](api.md)、[数据库基线](database.md)、[密钥与部署](deployment.md)及[UI 规范](ui-design.md)。扩展边界见[扩展性设计](extensibility.md)，完整目标表结构见[schema.sql](schema.sql)。实际交付状态继续以 development.md 为准。

