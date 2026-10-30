# 项目 Git 仓库关联设计

更新日期：2026-10-30。状态：已实现首版，运行迁移 8、23 张业务表。下文保留完整目标契约，首版差异见第 9 节。

## 1. 已确认范围

- 项目可关联零到多个 Git 仓库，支持不同服务连接，不设置主仓库、默认仓库或隐式排序优先级。
- 同一仓库可关联多个项目；同项目按连接和远端仓库 ID 去重。相同实例的不同连接视为不同来源，不按 URL 合并。
- 只有系统管理员可浏览远端、关联、解除关联和刷新远端信息；项目管理员没有额外管理权。
- 有效项目成员（含团队继承成员）及系统管理员可读取已保存的仓库信息。读取不触发远端访问，不授予 Git 平台访问权。
- 远端访问只使用该连接当前的系统首选凭证，不固定凭证、不使用个人/项目凭证、不自动取第一份、不使用兜底。
- 本轮只实现 GitLab 适配；数据库、接口与能力模型支持未来 Gitea 等平台，不预注册未实现的平台。
- 不包括代码浏览、clone/push、分支/MR、Webhook 创建/分发、定时同步及全局仓库资产管理。

## 2. 权限与生命周期

| 操作 | 项目成员/项目管理员 | 系统管理员 |
| --- | --- | --- |
| 读取已关联列表、复制不含凭证的地址 | 可 | 可 |
| 浏览组、搜索远端仓库 | 不可 | 可，项目须未归档 |
| 添加、单条/批量解除、刷新远端信息 | 不可 | 可，项目须未归档 |
| 查看系统凭证内容 | 不可 | 保存后不提供秘密读取 |

工作区展示只读仓库页签，即使当前用户是系统管理员也从控制台进入管理；后端基于身份和项目状态授权，不依赖页面位置。账号禁用、删除、受限改密会话沿用既有拒绝规则。

项目归档保留关联和快照，禁止所有管理性写入和远端查询，恢复后可维护。解除只影响本地关联，不删除远端仓库；本地解除不要求远端或凭证可用。允许空仓库、远端已归档仓库关联，明确展示标识。

连接停用保留关联并禁止远端访问；普通成员只读列表可显示连接停用标识，不公开连接配置和凭证资料。有任何仓库引用时禁止删除连接，返回 CONNECTION_REFERENCED；仅按当前凭证是否为空检查已不足够。有引用时禁止更换 config.base_url，避免相同 repo_id 在另一实例指向错误仓库；无变化保存允许，CA 更新允许。实例搬迁留待单独显式迁移流程。未来硬删除项目须同事务清理关联；当前仍不开放硬删除。

系统首选缺失、过期、停用、秘密不完整时阻止远端操作并提示管理员到服务集成维护。认证或权限失败不尝试其他凭证。自然过期实时判断；切换首选只影响之后的新调用。允许删除原首选凭证，沿用清除首选规则，不级联删除关联。

## 3. 浏览与选择交互

### 3.1 项目已关联列表

控制台项目详情新增「Git 仓库」页签，工作区同名只读。全宽列表呈现仓库名称、完整路径、连接、默认分支、远端归档标识、最近同步时间；地址通过详情/复制菜单呈现，避免长 URL 挤压列表。同步时间仅表示快照时间，不显示虚假的实时健康状态。

工具栏支持本地名称/完整路径搜索和连接筛选；分页默认 20，可选 10/20/50/100。按关联 ID 降序稳定排列。管理员可添加；每行保留详情和更多菜单，同步及解除收进菜单，解除项以分隔线及危险色区分。选中后才显示已选数量、批量操作菜单和取消选择，解除所选位于菜单内；批量解除先展示数量与完整目标清单，再确认。该清单只包含显式选中项，不把「当前页全选」解释成全部搜索结果。管理员的解除选择跨页保留，改变本地筛选时清空并提示。

失败显示明确错误并保留原有信息；空列表、筛选无结果、加载、请求失败独立展示。成员不能看到管理按钮和系统凭证名称。

### 3.2 添加关联

使用宽对话框或全屏面板：顶部选连接；中间左侧分组导航、右侧仓库列表；底部已选数量、查看已选、取消、确认关联。窄屏改为组选择入口与面包屑，结果单列展示。

- 连接目录仅展示声明仓库能力的实际类型，本轮只有 GitLab。停用连接可见但不可选。
- 默认「全部仓库」，覆盖凭证可访问的仓库，包括个人命名空间；不要求先选组，也不限制 membership=true/owned=true。
- 左侧组导航按需分页加载组与子组；不把仓库作为树节点，不全量扫描远端。组搜索返回扁平结果及完整路径，可直接进入；父组不可见时仍可从搜索进入可见子组。每级支持「加载更多」和失败重试。
- 进入组只列直接归属仓库；「包含子组」显式切换，默认关闭，不包含仅共享到该组的外部仓库。
- 远端仓库搜索默认范围为整个连接；进入组后可选择「当前组」。范围标签始终可见；当前组范围下递归开关影响搜索范围。搜索依据平台 API，不能承诺跨平台完全相同的全文/路径匹配算法，不能仅过滤已加载页冒充远端搜索。
- 输入 300ms 防抖；更换查询回到首屏，取消旧请求或丢弃旧响应。加载失败不覆盖已有选择。
- 当前页多选、跨页及跨组保留选择；查看已选可以移除。已关联项显示「已关联」并禁止勾选。每批最多 100 项（请求保护，不是项目仓库总数限制）。
- 每次添加限一个连接。切换连接且已有选择时明确确认清空，取消则保持原连接和选择。
- 保存只提交 repo_id 列表；后端重新读取详情并校验所有目标，整批成功或整批失败。一个失败也不产生部分关联，保留草稿并定位失败项。
- 全部失败、超时和首选缺失均给出可恢复提示。关闭有选择的面板需要确认丢弃；提交中禁用重复提交，结果未知时先读关联列表核实，不盲目重试。

## 4. 多平台模型与适配器

ServiceAdapter 增加可选 RepositoryProvider 能力，提供 ListContainers、ListRepos、GetRepo 三个受控只读操作。RepositoryCapabilities 包含 browse、search、containers、container_hierarchy、recursive_repos、container_label；不支持的筛选参数明确拒绝，不静默忽略。

通用 Container 为 `{id,parent_id,name,full_path,kind}`，ID 全部是字符串，kind 可为 group/organization/owner；无权限查看父级时不要求构建完整树。容器不落业务表。GitLab 映射组/子组，Gitea 后续按组织/所有者适配，无层级时不渲染展开按钮。平台差异留在适配器，项目关联模块不拼接平台 API 路径。

RepoSummary 为 `{repo_id,name,namespace_path,full_path,web_url,http_clone_url,ssh_clone_url,default_branch,remote_archived}`；缺失的 URL/分支/状态使用 null。列表摘要缺失可接受，保存必须 GetRepo 获取合格详情。

repo_id 是服务连接范围内稳定、不可变的远端身份，不是 AntCDP 关联记录 id，不是名称、路径或克隆 URL。使用 VARCHAR(255) utf8mb4_0900_bin，区分大小写且不忽略尾部空格；应用拒绝空串、首尾空白和控制字符，不统一 lower/trim。平台负责规范化：GitLab 数字 ID 转为无前导零的十进制字符串；未来 UUID、大小写敏感 opaque ID 原样保存。所有 JSON ID 均为字符串，禁止经 JavaScript Number 转换。超长或无稳定 ID 的平台必须明确扩展契约，不能截断或改用可变路径。

连接 service_type 决定适配器，不在关联表重复保存 provider 类型、secret 或 credential_id；关联归属、connection_id、repo_id 保存后不可修改，改目标需解除再关联。每项目保存独立快照，刷新 A 项目不会更改 B 项目。暂不建全局仓库资产表、任意 provider JSON 和远端组镜像。

### GitLab 映射与外部参考

使用 GET /api/v4/projects 获取全部/搜索结果，GET /projects/:id 获取详情；组浏览使用 /groups、/groups/:id/subgroups，组仓库使用 /groups/:id/projects，显式传 with_shared=false 与 include_subgroups。接口按连接基础地址和子路径构建，不接受客户端完整 URL。分页封装为平台无关不透明游标，不能把远端 Link URL直接返给客户端执行。

GitLab 的项目列表支持搜索；组项目接口支持包含子组和排除共享项目。正式适配须按支持的部署版本做契约测试，不依赖所有版本都返回总数。参考 [GitLab Projects API](https://docs.gitlab.com/api/projects/) 与 [GitLab Groups API](https://docs.gitlab.com/api/groups/)（核对日期 2026-10-30）。Gitea 后续适配参考其 [仓库搜索 API](https://docs.gitea.com/api/operations/repo-search/)，本轮不声明已支持 Gitea。

## 5. 数据库设计

完整阅读副本见 [schema.sql](schema.sql)。新增 project_repository，并在 project 增加 repositories_version BIGINT UNSIGNED NOT NULL DEFAULT 1；独立于资料 row_version、成员 membership_version。无物理外键/CHECK，所有引用和生命周期由事务保证。

| 字段 | 类型/规则 |
| --- | --- |
| id / project_id / connection_id | BIGINT UNSIGNED；id 为本地关联 ID，其余为逻辑引用 |
| repo_id | VARCHAR(255) utf8mb4_0900_bin，平台稳定身份 |
| name | VARCHAR(255)，非空 |
| namespace_path / full_path | VARCHAR(2048)，无命名空间时 namespace_path 为空，full_path 非空 |
| web_url / http_clone_url / ssh_clone_url | VARCHAR(2048) NULL，不含密码、Token 或查询认证材料 |
| default_branch | VARCHAR(1024) NULL；空仓库可为空 |
| remote_archived | BOOLEAN NULL；NULL 表示未知/平台不提供 |
| last_synced_at | DATETIME(3) NOT NULL，服务端成功快照时间 |
| last_sync_check | JSON NULL，只存白名单诊断与版本快照，不含原始远端正文 |
| row_version | BIGINT UNSIGNED NOT NULL DEFAULT 1 |
| created_by_user_id / created_at / updated_at | 创建者墓碑逻辑引用、UTC 毫秒时间 |

唯一键 (project_id,connection_id,repo_id)，索引 (project_id,id)、(project_id,connection_id,id)、(connection_id,id)、(created_by_user_id)。repo_id 索引最大约 1036 字节，适配 InnoDB 3072 字节限制；长路径不做唯一键或全长索引。初期本地关键词查询按 project_id 缩小范围后过滤，数据规模增长再评估全文检索。

last_sync_check 格式为 `{status,reason,started_at,finished_at,check_id,connection_version,config_version,credentials_version,credential_id,material_version}`，仅内部保存选择快照；成员响应只投影 status/reason/finished_at/outdated，不暴露凭证 ID/身份。无记录返回 null。诊断不等于实时可用性；版本变化使结果 outdated，单纯时间推移不标记健康。诊断回写不改变关联 row_version、集合版本、updated_at；成功刷新快照（包括 last_synced_at）会递增两种版本。新增时 last_sync_check 可为空，last_synced_at 已标记成功读取。

共 23 张业务表；project 新字段与新表通过迁移 8 实施，不把本文件直接导入现有安装。

## 6. API 目标契约

以下路径省略 /api/v1。P=/projects/{project_id}/repositories；C=/admin/projects/{project_id}/repository-connections。读 P 必须为有效成员或系统管理员；C 及所有写操作必须系统管理员。沿用 Cookie/CSRF、ID 字符串、严格 DTO、error.details 与强 ETag 规则。

| 方法/路径 | 输入与结果 |
| --- | --- |
| GET P | q、connection_id、page、page_size；返回 items,total,page,page_size,mutation_version，列表 ETag |
| GET P/{id} | 本地快照与对象 ETag；不联网 |
| GET P/{id}/diagnostics | 脱敏最近同步诊断，无 ETag；有效成员可读 |
| GET C | 可用类型的有限连接目录与能力；不返回 config、凭证或秘密 |
| GET C/{connection_id}/containers | parent_id、q、cursor、limit；items,next_cursor；查询组时返回扁平搜索结果 |
| GET C/{connection_id}/repos | q、container_id、recursive、cursor、limit；items,next_cursor，项含 already_linked |
| POST P | `{connection_id,repo_ids:["101","102"]}`；集合 If-Match；201 返回新增 items、mutation_version、X-Collection-ETag |
| POST P/batch-unlink | `{ids:["本地关联ID"]}`；集合 If-Match；200 返回 removed_ids、mutation_version、X-Collection-ETag |
| DELETE P/{id} | 对象 If-Match + X-Collection-If-Match；204、X-Collection-ETag |
| POST P/{id}/refresh | `{}`；对象 If-Match；200 返回更新 item、ETag、X-Collection-ETag；远端失败走错误响应并保存受控诊断 |

P 的 item 包含数据库非秘密快照字段，以及有限 connection={id,name,service_type,enabled}。不返回 last_sync_check 内部 JSON，诊断从独立端点获取。连接资料为关联投影，不属于关联对象写版本；GET 表示 ETag 另覆盖连接 row_version，mutation_version 只用于集合写操作。请求 If-Match 使用带命名空间的强标签：集合标签由 mutation_version 构造；GET 列表的 HTTP 缓存 ETag 不得作为集合写令牌。实现时与既有 DTO/客户端统一封装，不能混用缓存标签和写令牌。

本地 q 最大 100 字符；page_size=10/20/50/100。远端 limit 默认 20、最大 100；next_cursor=null 表示结束，不伪造 total。游标绑定连接、操作者、系统首选与材料/配置版本、查询条件，签名且有限期（建议 10 分钟）；不承诺远端多页结果为一致性快照，客户端按 repo_id 去重。更换条件/凭证令旧游标失效，要求重查。分组搜索不支持同时传 parent_id；scope 全部时省略 container_id，recursive 仅有容器且平台支持时接受。

新增与批量解除每批 1–100 个唯一 ID，超限拒绝，不静默截断。批量新增目标已经关联返回 409 REPOSITORY_ALREADY_LINKED，并列出当前项目内冲突项；前端刷新状态，用户移除冲突项后重提。批量解除任一 ID 不属该项目或不存在，整批失败，不泄露其他项目目标。成功后只有新增关联 ID 才进入成员可见列表。

关键错误：403 FORBIDDEN；404 NOT_FOUND；409 PROJECT_ARCHIVED / RESOURCE_DISABLED / SYSTEM_PREFERRED_REQUIRED / CREDENTIAL_UNAVAILABLE / CONNECTION_REFERENCED / CONNECTION_TARGET_LOCKED / REPOSITORY_ALREADY_LINKED / STATE_CHANGED；412 VERSION_CONFLICT；428 PRECONDITION_REQUIRED；422 VALIDATION_FAILED / CAPABILITY_UNSUPPORTED / CURSOR_INVALID；429 RATE_LIMITED；502 REMOTE_AUTHENTICATION_FAILED / REMOTE_ACCESS_DENIED / REMOTE_REPOSITORY_UNAVAILABLE / REMOTE_INVALID_RESPONSE；504 REMOTE_TIMEOUT。远端 404 文案为「仓库不存在或当前凭证无权访问」，不声称已删除。错误只给白名单原因，不透出 Token、远端正文或内部 URL。

## 7. 网络、并发与审计

1. 网络前验证账号、系统管理员、项目非归档、连接类型及启用，读取配置和系统首选凭证快照；仅受控适配器可解密。
2. 网络等待不持数据库锁；浏览单请求建议 10 秒上限，响应受大小限制；批量详情并发上限 4、整批预算 60 秒，超时整批失败。沿用目标地址/DNS 防护、禁止重定向、严格 TLS 与自定义 CA。后续请求始终从保存的连接构建，不跟随外部响应 URL。
3. 返回浏览结果前重新检查权限、项目、连接、首选及材料版本；变化丢弃旧结果。写入时按现有用户→团队→项目协议，再连接 ID、凭证 ID、关联 ID 顺序加锁，重新校验权限、状态、版本与引用。系统管理员路径无需无关团队锁。
4. 新增、解除和刷新写快照同事务更新 project.repositories_version 与审计；添加/批量解除每批只递增一次集合版本，不修改项目资料版本/updated_at。对象修改递增自己的 row_version；重复无变化命令不重复审计，刷新成功因同步时间变化仍更新版本。
5. 删除/换地址连接也必须持父连接锁并检查 project_repository；新增持同一父锁，避免检查后插入孤儿。自然过期在提交前重查。父状态停用再启用、首选切换再切回也通过版本发现变化。
6. 同对象并发刷新使用对象版本阻止旧快照覆盖新快照；失败诊断按开始时间及随机 check_id 保留较新结果，提交时重查快照、对象存在及项目可写，变化不落诊断。诊断写入不得绕过归档限制。
7. 新增/解除记录 actor、project_id、association_id、connection_id、repo_id、路径快照；成功刷新记录更新字段名、结果，不存正文/秘密。搜索浏览不逐条制造业务审计；沿用受控访问日志和限流。

URL 校验区分展示与网络访问：web_url 只允许无认证的 HTTP(S) 并以安全外链打开；HTTP clone URL 不含 userinfo；SSH clone URL 允许标准 git 用户及 scp 风格，但禁止密码、控制字符和认证参数。平台返回的 URL 仅保存展示，绝不作为后端请求目标。所有外部文字按文本渲染，复制地址不拼接 Token。

## 8. 验收清单与交付边界

- 成员只读、项目管理员无管理权限、系统管理员旁路、归档只读、失权后的并发请求均由服务端验证。
- 多连接、多仓库、重复关联冲突、跨项目复用、大小写敏感/UUID/大整数 repo_id、空仓库和远端归档。
- 全部/组/子组/个人仓库、组分页和组搜索、全连接与当前组搜索、跨页选择、连接切换、批量原子失败、旧响应不覆盖新搜索。
- 首选缺失、自然过期、轮换、认证失败、403/404、超时、连接停用及更改地址保护；不回退、不删除旧快照。
- 新增与连接删除竞争、项目归档竞争、并发解除/刷新、游标失效、ETag 冲突、诊断顺序、事务回滚。
- 实施时验证 MySQL 迁移/回滚边界、索引和唯一性，运行适配器契约测试、授权/事务测试、前端相关测试及 CI 同版本 golangci-lint。
- 静态 HTML 仅使用演示数据；可演示组导航、搜索、分页、多选/解除、只读/归档、失败和浅深色，不连接 GitLab，不证明 API、数据库或远端行为已实现。原型放仓库外，不纳入 Git。

## 9. 首版实现与验证边界

首版实现 GitLab 连接目录、按层加载组/子组、组搜索、整个连接/当前组仓库搜索、递归子组、游标分页、跨页多选与批量原子关联、只读详情、单条刷新、脱敏同步诊断、批量解除（单条解除复用该命令）、成员只读与归档限制。危险操作按最新确认收进更多/批量菜单，解除需确认完整清单。

实际 DTO 的连接白名单为 connection_id/connection_name/service_type/connection_enabled 平铺字段；对象 etag 和列表 mutation_version 为完整带引号写标签。GET 列表不提供缓存 ETag，使用 X-Collection-ETag 和 mutation_version；单条对象标签仅覆盖关联行，连接实时投影不参与客户端缓存（API no-store）。远端每页固定 20，无 limit 参数；组浏览采用当前层列表与上一级导航，不构建完整树。批量详情首版按顺序请求，整批最多 60 秒；失败保留全部选择，不产生部分关联。首版单条解除统一调用 batch-unlink，不另提供 DELETE 路由。新建关联的成功时间直接存于 last_synced_at，独立诊断在手动同步后产生；同步失败保留快照并写入白名单诊断。

验证采用真实 MySQL 隔离数据库和受控 GitLab HTTP 模拟服务，覆盖凭证认证调用、组范围、搜索分页、游标绑定、批量回滚、重复关联、刷新、授权、连接引用保护、归档只读和迁移升级。不等同于所有 GitLab 部署版本兼容性验证；用户已有 GitLab 的真实目录与权限需在验收时核对。Gitea 尚未实现适配器。

### 批量同步与选择器优化

系统管理员点击“批量操作”进入选择模式后才展示 checkbox 列；勾选仓库后可同步信息。未选择时同步和更多禁用，解除关联收在更多菜单；退出清空选择并隐藏 checkbox，完成同步仍保留选择模式。客户端最多同时处理 3 个仓库，各自先读取当前关联版本，再调用既有单条 refresh API；不新增批量服务端路由，不承诺整批原子性。每次调用仍由服务端校验权限、归档、连接及当前系统首选凭证。单项失败不会中断其余项，结果展示成功/失败及受控错误原因，成功项取消选择、失败项保留选中供重试。任务依赖当前页面，关闭页面不保证未开始项目继续执行。

选择器使用固定高度双栏、当前组面包屑、独立滚动列表和固定分页/提交栏；已选列表在结果区切换展示，保留跨页选择与切换连接确认。搜索切换与关闭会使旧响应失效，提交失败保留选择。详情分区展示元信息、克隆地址与同步诊断。
