# 项目产品分支、环境与 Git 分支模型设计

发布模块以产品分支主干作为每仓快照目标，扩展 Tag 前缀与活动发布期间的归档/删除约束。具体契约见[项目产品分支发布管理](project-releases.md)。

状态：当前版本已实现。本模块七张表包含于统一初始迁移；当前基线为版本 1，共 48 张业务表；完整 DDL 阅读副本见 [schema.sql](schema.sql)。本文描述当前契约，验证范围和限制见 [开发说明](development.md)。

## 1. 范围与术语

### 1.1 已确认的产品边界

中文业务名称统一为“产品分支”，英文领域术语保留 `variant`。产品分支用于管理标准版与客户定制版，各自维护仓库范围、主干 Git 分支、环境和发布记录。界面不将产品分支简称为“分支”；仓库中的具体分支称为“Git 分支”。内部标识、API 路径、字段及数据库名称继续使用 `variant`。

- 项目下管理产品分支 `variant`，产品分支下管理环境 `environment`。不使用 version 表示产品分支；version 用于具体版本号，release 分支不等于发布记录。
- 每个项目有默认标准版；其他产品分支承载客户定制等独立维护需求。每个产品分支配置一个跨仓库统一的主干 Git 分支名称。
- 七种 Git 分支类型内置，项目启用一种或多种；每个启用类型只配置一条命名规则。类型可匹配多个具体分支，多个产品分支共用项目 Git 分支模型。
- 环境绑定一个固定 Git 分支名；所有命中仓库使用同名分支，不按仓库覆盖、不自动选择最新分支。主线、开发、集成、发布、定制可绑定环境；功能、修复不可绑定。
- 产品分支默认包含全部项目仓库。环境默认继承，可在产品分支范围内选取子集。支持手动勾选、通配符和正则匹配，手动与规则取并集；仓库列表或已保存路径变化后重新匹配。
- 同一仓库可进入多个产品分支、多个环境；多个环境可以绑定同一分支。配置保存不依赖远端 Git 分支一定存在或连接一定可用。
- 系统管理员及项目管理员可管理，其他有效项目成员只读。项目归档只读，产品分支可归档；本地删除不删除远端 Git 分支。
- 批量创建仅覆盖产品分支主干 Git 分支；来源提供统一默认值和逐仓库覆盖。既有目标不覆盖，需明确选择使用；部分成功保留结果，允许重试失败项。
- 不实现分支合并、重命名、远端删除、保护规则修改、MR、构建部署、发布管理、通用工作流、自动分支创建或定时远端同步。
- **Agent 说明文档及其存储、编辑、生成、分发接口不在本次范围；Agent 调度和执行也不在本次范围。** 不因未来 Agent 使用而预建相关字段、表或模块。
- 当前版本提供一套初始配置；不实现多模型模板库、模板切换、模板版本管理或产品分支独立 Git 分支模型。

### 1.2 设计约定与实现状态

以下字段上限、默认规则、HTTP 路径、事务与恢复方案对应当前版本实现。技术参数变更同步本文与 SQL；改变上述产品范围需另行讨论。

```text
项目（独立 Git 分支模型、已关联仓库）
├─ 标准版 variant：主干 main，仓库 all
│  ├─ 测试：develop，仓库 inherit
│  └─ 生产：main，仓库 inherit
└─ A 客户版 variant：主干 custom/customer-a，仓库 custom
   ├─ 测试：integration/customer-a，仓库 inherit
   └─ 生产：custom/customer-a，仓库 inherit
```

环境的分支独立于产品分支主干，不自动追随主干名称变更。variant 是业务归属，不根据分支前缀推断归属，也不验证提交祖先关系。不同产品分支可显式引用同一分支。

## 2. 项目 Git 分支模型

### 2.1 类型与初始配置

| 类型标识 | 中文名 | 默认语义 | 初始规则模式 / 内容 | 可绑定环境 |
| --- | --- | --- | --- | --- |
| mainline | 主线 | 标准版的主干 Git 分支 | exact / `main` | 是 |
| development | 开发 | 持续承接日常开发 | exact / `develop` | 是 |
| integration | 集成 | 汇集多个开发来源并联调 | glob / `integration/**` | 是 |
| release | 发布 | 准备或维护具体发布 | glob / `release/**` | 是 |
| feature | 功能 | 实现具体功能 | glob / `feature/**` | 否 |
| hotfix | 修复 | 问题修复 | glob / `hotfix/**` | 否 |
| custom | 定制 | 客户定制版的主干 Git 分支 | glob / `custom/**` | 是 |

初始只启用 mainline，其他类型保留上表默认规则但禁用。创建定制产品分支前启用 custom。项目可将 `develop/**` 设为集成规则，开发类型使用其他规则或保持禁用。类型标识、中文名、环境资格由代码注册，客户端不可新增类型或修改资格；不提供流程文档编辑字段。

模型使用固定七条类型记录，PUT 整组替换，必须提交七个互不重复的合法标识，至少一个启用。禁用记录允许保留合法规则或提交 rule=null（数据库 mode/pattern 均为空）；启用记录必须有非空且可编译的规则。默认标准版始终引用 mainline，因此当前版本 mainline 实际不能停用；其他类型按引用限制停用。

### 2.2 单条规则语义

规则为 `{mode: exact|glob|regex, pattern: string}`，最大 1024 UTF-8 字节；匹配完整字符串，不做子串搜索、不自动改名。exact/glob 区分大小写；regex 默认区分大小写，允许 Go 正则显式 flags 改变行为，并在测试面板提示。不做 Unicode 规范化或自动转小写。

- exact：精确匹配。用于分支时，pattern 本身必须是合法具体分支名。
- glob：自定义受限语法，`*` 匹配零个或多个非 `/` 字符，`?` 匹配一个非 `/` 字符，`**` 匹配零个或多个任意字符（包括 `/`）。其余字符按字面量处理；不实现字符组、花括号、否定规则或反斜杠转义，连续三个及以上 `*` 拒绝。`a/**/b` 中两个斜杠均为字面量，不隐含匹配 `a/b`；这不是 Git ignore 或系统文件路径 glob。
- regex：使用 Go `regexp` 语法，将输入包在 `\A(?:PATTERN)\z` 后编译；不支持回溯引用或 lookaround。前端不使用 JavaScript RegExp 作为最终判定，调用服务端测试接口。

对具体分支先执行 Git 引用名称校验，再匹配已启用类型：零个匹配为 unclassified，一个为 valid，多个为 ambiguous。保存绑定时提交 `branch_type`，必须与唯一匹配一致；不按顺序选择、不以手工指定类型消除歧义。

```text
glob feature/**：feature/login、feature/team/login 通过；feature 是合法分支名但不匹配；feature/ 是非法分支名
glob feature/*：feature/login 通过；feature/team/login 不匹配
exact main：main 通过；Main 不匹配
regex (main|master)：main、master 通过；main-old 不匹配
```

具体分支为 UTF-8 短名称，最多 1024 字节；不接受 `refs/heads/` 前缀、`HEAD`、前导 `-`、`@{-1}` 展开表达式。按 Git 分支名称规则拒绝空格/控制字符、`..`、`@{`、反斜杠、非法标点、前后或连续 `/`、以 `.` 开头或以 `.lock` 结尾的路径段、末尾 `.`、单独 `@`。不 trim 或静默规范化输入。服务端实现纯校验，不拼接 shell 命令；具体远端仍可能施加额外限制。

### 2.3 修改规则的影响

编辑时可测试未保存的候选模型，返回已绑定产品分支主干与环境的完整影响清单（包括归档对象）：不匹配、歧义、类型变化。服务端保存时再计算；有影响且未确认返回 409 RULE_CHANGE_IMPACT，确认必须提交该次 impact_token。它是规范化内容的 SHA-256 摘要，覆盖项目 ID、候选规则及本地相关版本（模型、全部产品分支与环境集合/对象版本），服务端在写事务内重算比较；发生相关变化后重新预览。该值仅防止确认过时影响，不是授权令牌，不增加专用签名、有效期或持久化表；权限与模型 If-Match 独立检查。

用户确认后允许保存规则，不自动改名、改绑或改变已有 branch_type。受影响对象显示 `binding_validity=invalid` 及原因；可修改无关资料或归档，但新的绑定保存、远端校验及创建必须先修复绑定。该状态按当前规则计算，不维护易过期的重复布尔列。

停用类型比改规则更严格：任一产品分支或环境仍引用该类型时返回 BRANCH_TYPE_REFERENCED，包括归档或已经不匹配的对象。不得通过同时改 pattern 绕过。不存在任何“通配规则必然不重叠”的承诺；当前版本只对具体名称和已保存绑定判断歧义，不分析任意正则的交集。

## 3. 产品分支与环境生命周期

### 3.1 产品分支

字段：id、project_id、code、name、summary、kind、main_branch、repository_scope、archived_at，以及版本、创建者和时间。kind 为 standard/custom，创建后不变；standard 使用 mainline 类型，custom 使用 custom 类型，不另外储存可矛盾的主干类型字段。

- 每个项目恰好一个 standard，默认 code=`standard`、name=`标准版`、main_branch=`main`、仓库 all；名称和主干可编辑，code 不可修改。不根据远端 default_branch 猜测或自动替换。
- standard 不允许删除、归档、转换为 custom 或转移默认身份。custom 可归档、恢复、删除；归档后环境及远端操作只读，允许项目未归档时恢复或在无环境、无执行中批次时删除产品分支。
- 删除 custom 前必须清空环境；归档产品分支下不能删除环境，应先恢复。删除清理产品分支的最近校验记录，保留创建批次历史与名称快照；远端不变。
- 主干统一名称，无逐仓库主干覆盖。`main`/`master` 混用的项目须统一命名或调整仓库范围；来源分支的逐仓库覆盖仅用于创建，不改变目标名称。
- 修改主干是重新指向其他具体分支，不重命名远端、不修改环境绑定。旧批次保留原目标快照，之后不能以旧批次对新主干执行。

### 3.2 环境

字段：id、project_id、variant_id、code、name、summary、branch_type、branch_name、repository_scope，以及版本和时间。

- code、name 在所属 variant 内分别唯一，因此标准版和客户版都可有 test/测试、staging/预发布、production/生产。
- 不内置强制环境数量、执行顺序或部署阶段，不自动创建三个环境。名称是显示信息，不决定权限或 Git 分支类型。
- branch_name 必填且固定，允许五类；不支持 tag、提交 SHA、动态 latest 或逐仓库分支覆盖。环境不得跨 variant 移动，需新建后删除原环境。
- 环境可编辑、删除；当前版本不单独提供环境归档。删除清理最近校验，不删除 Git 分支或基础设施。

产品分支和环境的 code 为 2–64 个 ASCII 字母/数字/下划线/连字符，首尾字母或数字，大小写不敏感唯一且保留输入大小写；创建后不可变。name 为去除首尾空白后的 1–100 个 Unicode 码点，使用 utf8mb4_0900_as_ci（忽略大小写、区分重音）；summary 最多 300 码点，纯文本。归档仍占用名称与编码；实际删除后允许复用，审计和历史始终按 ID 区分。

## 4. 仓库范围与动态匹配

### 4.1 选择器格式

只允许选择当前项目已关联的 `project_repository.id`，不是远端 repo_id；不会浏览整个 Git 平台或自动关联仓库。

```json
{
  "mode": "custom",
  "repository_ids": ["101", "102"],
  "rules": [
    {"connection_id": "7", "mode": "glob", "pattern": "group/customer-a/**"},
    {"connection_id": null, "mode": "regex", "pattern": "platform/(web|api)"}
  ]
}
```

- variant 允许 all/custom；环境允许 inherit/custom。all/inherit 时数组必须为空，不允许夹带隐藏条件。
- custom 为手动 IDs 与规则结果取并集并去重；数组允许为空，表示空范围。每份选择器最多 500 个唯一手动 ID、20 条互不重复规则，总 JSON 最多 24 KiB。
- 仓库规则匹配本地快照 `full_path` 完整路径，支持 glob/regex，沿用第 2 节语义与单条长度限制。connection_id 可为空；非空须来自该项目关联仓库的连接。不按仓库名称、URL 或服务显示名称匹配。
- 多条仓库规则是跨连接和目录的范围条件，与“每个 Git 分支类型仅一条命名规则”是不同契约。
- 环境 custom 的候选仓库始终限制在 variant 当前范围；提交手动 ID 不在父范围时报字段错误，规则自动取交集，不能扩大父范围。

### 4.2 求值与变化

令 P 为当前项目已关联仓库，V 为 variant 选择结果，环境结果为 inherit→V，custom→V∩（手动∪规则匹配）。全量求值后再分页，禁止只匹配已加载的一页。按关联 ID 升序展示，逐条返回 match_sources（manual、rule 的数组序号、all/inherit）。

不持久化动态匹配结果表；保存选择意图，在读取范围、准备校验、创建计划时以一致的本地快照求值。返回不透明 `scope_token`，覆盖项目/主体 ID、project.repositories_version、模型版本、variant 版本、环境版本（如有）及规范化选择器；使用固定版本的规范化 JSON 与 SHA-256 摘要，服务端以当前状态重新计算比较，不解析客户端 token 来恢复状态。它是本地范围快照凭证，不表示远端状态或授权。

- 仓库新增/解除、远端信息手动刷新改变 full_path、选择器修改，下一次求值即更新。远端自行改名尚未同步时继续按保存路径匹配，页面显示快照时间，不承诺实时获知。
- 连接停用、远端归档、凭证不可用不移出本地范围，显示单独诊断状态。
- 规则限定的连接已无项目关联仓库、甚至已删除时，原规则保留为不匹配的选择意图，不阻止连接删除。编辑时可原样保留已保存的休眠规则；新增或改变规则的 connection_id 必须来自当前项目关联仓库。页面标明连接不可用，不跨项目查询其目录或公开已失权连接资料。
- 解除项目仓库关联时，同事务从全部产品分支/环境的手动 ID 数组移除该 ID、清理对应最近校验、递增受影响对象和集合版本。规则保留，以后重新关联得到新 ID，只有规则可能再次命中。
- 父 variant 缩小范围时，环境原手动选择保留为“当前不在父范围”，不参与有效结果；父范围恢复后可重新生效。环境下次保存 custom 选择器时必须移除失效手动项或先调整父范围。
- 范围变化可显示已增加/已移除清单，不触发远端请求或分支创建。新增仓库为未校验；原结果按版本判定过时。
- 零仓库合法，不显示“全部通过”；检查/创建按钮禁用并提示先选择仓库。

## 5. 权限与既有模块边界

| 操作 | 普通有效成员（含团队继承） | 项目管理员 | 系统管理员 |
| --- | --- | --- | --- |
| 查看配置、有效仓库、脱敏校验、创建历史 | 可 | 可 | 可，独立旁路 |
| 保存模型、产品分支、环境与生命周期 | 否 | 可 | 可 |
| 本地规则/范围草稿预览、远端 Git 分支校验 | 否 | 可 | 可 |
| 准备/执行/重试主干创建 | 否 | 可 | 可 |
| 浏览远端仓库、关联/解除、刷新仓库快照 | 否 | 否 | 沿用现有权限 |
| 查看凭证秘密或更改系统首选 | 否 | 否 | 沿用集成模块，不经本模块提供 |

项目管理员必须是直接项目 admin，团队管理员不自动继承。用户禁用、删除、受限改密会话及失去项目权限即时影响后续请求。项目归档阻止管理性写入、网络请求与草稿预览；已有配置、历史可读。产品分支归档同样阻止其管理与远端操作，恢复/允许的删除除外。

新增能力明确授权项目管理员通过受控服务，使用已关联连接的当前系统首选凭证执行分支读/创建；不授予系统凭证管理权、不开放任意 repo_id/URL。不改现有 `projectRepoAccess(write=true)` 的系统管理员限制，应新增独立用例授权并复用底层凭证选择与网络适配器。

不使用个人/项目凭证、不兜底、不隐式选择第一份凭证；首选缺失、失效或远端拒绝时明确失败。Git 平台最终决定创建权限；可读或 `can_push` 字段不能证明任意目标名称一定可创建，尤其涉及保护规则时。UI 不显示未经验证的“可创建”保证。

## 6. 真实分支校验

当前版本 GitLab 通过受控 HTTP API 查询指定仓库、指定分支，不 clone、不启动本地 Git、不扫描全部分支。新增可选 BranchProvider 能力：`GetBranch(repo_id, name)`、`CreateBranch(repo_id, name, source_commit)`；GetBranch 返回 exists/missing/unknown 的受控结果，适配器内部负责可见性确认，只投影 name、commit_id、protected、default 等必要字段。暂不提供远端 Git 分支列表选择器，输入完整分支名后校验。

GET 分支返回成功表示 exists，返回提交 ID 和检查时间；分支 404 后，以同一凭证向该仓库分支列表发一次 `per_page=1` 的受控请求确认代码仓库读取能力，列表 200（可为空）才报告本次观察为 missing。仅 GetRepo 元信息可读不足以证明代码仓库可读；列表 403/404、认证失败、超时、能力不支持均为 unknown，不能声称分支已删除。若探测项恰好是目标分支，改记 exists；任何结果都仅表示这次非原子观察。不存在检查记录则为 unchecked，数据库不为它写伪结果。空仓库在列表可读且为空时为 missing，创建仍需要有效来源提交。

校验同时呈现两个维度：本地 `binding_validity` 与远端 `status=exists|missing|unknown|unchecked`，另有 outdated。校验结果仅是某时刻观察，不能作为之后创建/部署的授权或存在性证明。

每次请求显式选择当前范围内 1–100 个仓库，不能把“全选当前页”扩大为全部。服务端并发最多 4、单次远端调用最多 10 秒、整次校验最多 60 秒；未开始项返回 unchecked/budget_exceeded，客户端可继续选下一批。成员 GET 从不发网络请求。页面批量校验由用户发起，不设后台自动扫描。

最近结果按 subject_kind（variant/environment）、subject_id、project_repository_id 唯一，保存分支名、检查开始/完成时间、随机 check_id、scope_token 摘要和连接/凭证版本快照。新旧结果按 started_at、check_id 排序；写回前重新授权并校验对象、范围和配置，变化则丢弃旧结果。诊断写入不递增配置编辑版本。

outdated 由当前本地范围、对象/模型/仓库和连接/凭证版本比较得出。单纯时间流逝不推断健康；连接/凭证状态改变立即使结果过时。成员响应不含凭证 ID、用户名、密文、内部连接地址或远端原始错误。

仓库与分支、创建主干 Git 分支及环境仓库列表均显示当前目标分支。过时结果或校验分支与当前目标不一致时，状态列显示“需重新校验”，详情保留历史分支、结果和提交，不把旧结果展示为当前目标的存在性结论。创建页也提供“校验所选分支”；刷新只读取本地结果，校验才查询远端。

## 7. 批量创建产品分支主干

### 7.1 创建计划

先保存产品分支资料，再通过独立操作准备清单。每批选定有效范围内 1–100 个仓库，不能使用动态“未来匹配项”；目标取产品分支当前主干名，客户端不得另传目标。

请求提供 default_source_branch 和按关联 ID 的 source_overrides，来源必须为合法具体分支名，但不要求符合项目已启用类型规则（允许从旧命名分支派生）。不支持来源 tag、裸 SHA 输入或自动 main/master 回退。服务端解析每个来源分支的完整 commit ID，将其冻结在计划中；创建时传提交 ID，来源后来移动不改变起点。

计划逐项检查目标和来源，得到 `preview_state=ready|existing|error`。ready 必须有来源提交，existing 保存目标提交用于明确采用，error 保存受控原因；目标已存在时可不要求来源存在。计划响应显示目标、来源、提交和凭证可用诊断，不宣称完成远端写权限验证。

服务端保存不可变计划与 item 快照，包括连接、远端 repo_id、路径、版本和操作者；不存秘密。计划有效期 10 分钟，从准备完成起计。准备全程无远端写；超时/失败项可记录为 error。若结束前本地配置、范围、关联或凭证快照变化，整份计划不落库并返回 STATE_CHANGED。

准备与人工核实同样限制为最多 100 项、并发 4、单次远端调用 10 秒、整个请求 60 秒。source_overrides 中 ID 必须唯一且属于本次选择，缺失项使用默认来源；不得夹带其他仓库。计划全部 error 时可保存并展示原因，但 can_execute=false；重查应重新准备计划，而不是重试从未执行的 pending 项。

### 7.2 明确执行

用户审阅后提交每项 action：ready 可选 create/skip；existing 可选 use_existing/skip；error 仅能 skip。每个计划项恰好提交一次，不允许重复/新增 ID。use_existing 不重置、合并或比较功能差异；执行前再次读取目标，提交 ID 与预览不同则要求重新预览，不能静默采用变化后的内容。

执行前验证计划未过期、操作者仍有管理权、项目/产品分支可写、目标和模型有效、本地与凭证版本一致。当前版本只允许准备者执行自己的计划，其他管理员可查看或另建计划。同一产品分支同一时刻最多一个 executing 批次。

每个 create 项先持久化 `creating` 与 started_at，再发一次创建请求；网络期间不持数据库事务锁。目标在预览后已经出现时记为 failed/target_exists，用户必须重新预览并明确使用，不强推、不覆盖。不同仓库分别提交，不提供跨仓库原子回滚。

批次为一次显式 HTTP 请求驱动的有限执行：并发最多 4、单个远端调用 10 秒、整批 60 秒。关闭页面、请求取消或时间预算耗尽后不继续调度；已开始的请求可能仍在远端完成，未开始项记 not_started。不新增通用后台作业队列或无人值守重试。

### 7.3 幂等、未知结果与重试

- 准备请求携带 UUID `Idempotency-Key`；同项目、同准备者相同 key/内容返回原计划，不重复插入；内容不同返回 409。请求摘要覆盖规范化输入和目标产品分支 ID。
- 执行携带计划 ETag；首次执行必须匹配。已经开始执行的相同内容重放，在重查调用者身份及权限后按 execution_hash 返回当前状态，即使原 ETag 已旧也不再次外发；不同内容返回 409。除这一幂等重放外不绕过 If-Match；保存 execution_hash 保证检查基于完整动作清单。
- 项结果：pending、creating、created、used_existing、failed、unknown、skipped、not_started。只有平台明确确认成功并校验响应目标/提交一致才记 created；超时、断线、5xx、成功响应无法验证或远端已成功但本地回写失败均需按 unknown 处理。failed 仅表示已确认未创建，例如外发前校验拒绝或适配器确认的远端明确拒绝；HTTP 客户端不得自动重试创建 POST。
- 执行启动时在事务内把批次变为 executing，设置一次性 90 秒 lease（started_at + 90 秒）。服务启动及每分钟维护检查到期批次，将遗留 creating 标记 unknown，pending 标记 not_started，批次置 interrupted 并释放占位；不自动调用远端、不自动重发。恢复处理是历史记账，不是恢复业务执行。
- 每项必须通过条件更新从 pending 领取到 creating 后才可外发 create；结果回写要求批次仍 executing、lease 未过期且原 item 仍 creating。回写与恢复在批次行锁下串行，恢复后的迟到响应不得把 unknown 覆盖为 created 或重新打开批次，只记录受控访问日志供排查，业务结果由人工核实补充。use_existing 的只读核实后同样检查批次/版本并从 pending 条件转移；不新增执行轮次或通用租约框架。
- 管理员可对已经结束或 interrupted 的批次显式发起 reconcile，仅执行远端读，将观察附在原项 reconciliation JSON，保留 unknown 的历史事实。即使目标提交等于预览来源，也不能证明是本次调用创建；后续可明确 use_existing。原产品分支已删除/归档、项目归档、关联已解除时不再发远端核实请求，历史仍可读取。
- retry 创建一份新计划并设置 retry_of_id，不修改原清单。仅接受原失败、未开始和未知项；unknown 必须先重新核实，目标存在走明确采用，不存在才允许新建。全部来源、凭证与当前目标重新预览，重新确认，不默默沿用旧来源提交。
- 原目标或产品分支已改变/删除时，不提供旧批次 retry；用户基于新配置重新准备。成功/采用/跳过项不得混入“重试失败项”。

存储的批次 status：prepared、executing、completed、partial、failed、interrupted。completed 表示至少一项成功或采用，且其余仅 skipped；partial 表示成功/采用与失败/未知/未开始混合；没有成功且执行正常结束为 failed；进程/请求中断为 interrupted。全部 skip 不允许执行。`expired = status为prepared且expires_at已到期` 是响应派生字段，GET 不写数据库；到期执行返回 PLAN_EXPIRED，不外发。结束时所有 item 必须为终态，剩余 pending/creating 按未开始/未知处理，不能先释放 active_slot 再收尾。item 状态是最终判断依据，不用批次成功掩盖单项异常。

### 7.4 竞态与不可回滚边界

执行开始后，阻止同产品分支资料/范围/主干修改、归档或删除，以及项目 Git 分支模型修改；阻止解除涉及的仓库关联，返回 BRANCH_OPERATION_IN_PROGRESS。环境资料修改可继续，不影响创建目标。prepared 计划不锁配置，配置变更直接使其过时。

账号撤权、项目归档、连接/凭证停用或轮换仍可执行；每次外发前重新检查，变化后停止新请求。已经发出的远端请求无法撤回，成功事实仍须保存为操作结果，不因当前权限已失效丢失历史；调用者无权时不返回项目详情。此有限记账只更新原 item 和批次，不更新配置或最近校验，不授予新的外发权。

两个项目或不同连接可能指向同一个物理仓库；本地占位不能消除跨项目/外部系统竞争。以远端创建不覆盖语义处理冲突；不按 URL 猜测并合并身份。

## 8. 数据库与存储约束

### 8.1 七张业务表

| 表 | 职责与主要唯一约束 |
| --- | --- |
| project_branch_model | 项目单例；project_id 主键，模型 row_version、产品分支集合 variants_version |
| project_branch_rule | 固定七类型；主键 (project_id,branch_type)，enabled、rule_mode、rule_pattern |
| project_variant | 产品分支、主干、范围、归档；项目内 code/name 唯一；(project_id,standard_slot) 唯一 |
| project_environment | 环境及固定 Git 分支；variant 内 code/name 唯一 |
| project_branch_check | 每对象每仓库最近诊断；(subject_kind,subject_id,project_repository_id) 唯一 |
| project_branch_creation | 创建计划/执行汇总、不可变配置快照、幂等；(project_id,created_by_user_id,idempotency_key) 唯一；(variant_id,active_slot) 唯一 |
| project_branch_creation_item | 每仓库来源、目标快照、动作、结果；(creation_id,project_repository_id) 唯一 |

全部使用 InnoDB、BIGINT UNSIGNED ID、UTC DATETIME(3)，无物理外键/CHECK/数据库 ENUM。SQL 不写默认账号、项目、variant 或其他种子；初始化由应用事务和未来迁移完成。

standard_slot：standard 固定 1，custom 为 NULL，保证每项目至多一个标准版；恰好一个由初始化和禁止删除保证。active_slot：executing 固定 1，其余为 NULL，结束/恢复时原子释放，避免并行批次。应用校验状态/slot/时间的组合，不依赖 MySQL CHECK。

主干/环境/来源/目标分支采用 VARCHAR(1024) utf8mb4_0900_bin，不索引完整名称；应用字节上限比列码点容量更严格。commit_id 使用 VARCHAR(128) ascii_bin，适配器负责校验完整提交标识，不假设所有平台只能使用 40 位。

repository_scope JSON 必须按第 4 节严格解析，数组里的 ID 是十进制字符串；不允许任意 provider 字段。选择器只是有界配置，实体、诊断和执行记录仍使用独立表，不放入 settings KV。JSON 手工引用的清理必须经过项目行锁，不能依赖 JSON 外键。

### 8.2 JSON 快照格式

- check.snapshot：`{scope_digest,repository_version,remote:{connection_version,config_version,credentials_version,credential_id,credential_version,material_version}}`。scope_digest 覆盖项目、产品分支、环境、模型及仓库集合版本和范围配置；不存在环境时使用零值参与摘要。显式版本和 ID 使用字符串，remote 仅内部保存，不含秘密。
- creation.config_snapshot：`{scope_digest,variant_code,variant_name,variant_kind}`。模型、产品分支及仓库集合版本已包含在 scope_digest 中。目标名称独立列保存；project_id、variant_id 独立列作为历史归属。
- item.remote_snapshot：`{connection_version,config_version,credentials_version,credential_id,credential_version,material_version}`；不保存秘密。item 的 connection_id、repo_id、repository_version 独立列定位目标。准备失败而无可用首选凭证的项，未知凭证版本/ID 为字符串零值；这类项只能 skip，不能凭不完整快照执行写入。
- item.reconciliation：null 或 `{status,reason,commit_id,checked_at,checked_by_user_id}`，仅保存最近一次人工核实；历史状态仍保留。

reason 使用应用注册的短码，不存远端正文。所有快照只由服务端构造；禁止客户端覆盖。成员 GET 采用显式白名单 DTO，不直接序列化上述内部 JSON。

### 8.3 逻辑引用与保留

model/rule/variant/environment 引用现存 project，environment.variant_id 必须属于同一 project。check.subject_id 必须按 subject_kind 解析为同项目现存产品分支或环境，repository 必须在其有效范围；不提供任意表名或多态查询输入。

创建批次属于现存项目，保存时 variant/repository 必须合法；删除产品分支或解除仓库后，历史中的 variant_id、project_repository_id、connection_id、repo_id 可仅作为历史身份，不要求目标继续存在。读取历史通过 project 当前权限，不通过失效对象授权。item 快照含 repository_path，不依赖联表恢复历史路径。

最近校验随主体/仓库解除而清理；范围改变但关联仍存在时旧行可保留，读取只列当前范围并标记过时。prepared 且从未执行的计划在 expires_at 之后保留 7 天；执行过的批次与 items 当前版本保留、不提供用户删除接口。清理未执行计划时先删除 items 再删 parent；retry_of_id 只允许引用执行过的终态批次，不允许引用待清理计划。审计采用现有保留策略。

### 8.4 版本与锁

- 模型 row_version 覆盖七条规则，整组更新只增一次；variants_version 覆盖产品分支创建、编辑、归档、恢复、删除。两者互不因诊断改变。
- variant.row_version 覆盖自身资料、主干、范围、生命周期；environments_version 覆盖环境增删改。环境改动不增加 variant.row_version，但增加 environments_version。environment.row_version 覆盖自身配置。
- 批次 row_version 覆盖计划状态与 item 动作/结果，每次事务变更递增；诊断 check_id 独立，不充当配置写令牌。无变化的配置命令不增版本、不重复审计。
- 沿用账号→相关团队→项目授权锁顺序；项目行锁统一保护模型、产品分支、环境和仓库范围，不另建子配置锁协议。执行领取先锁 creation，再按连接 ID 升序读取连接及凭证快照；涉及 item 的写入由该 creation 行锁串行化。纯结果落账和恢复只取得 creation/item，不反向请求项目或连接锁。解除仓库入口先锁 project，再检查执行占位和清理依赖，不先锁子表再回锁项目。
- 远端调用前读取授权和版本快照，释放事务；返回后按相同顺序重查。检查结果过时即丢弃，远端写事实按第 7.4 节有限落账。
- 成员/账号变更沿用现有并发协议；网络期间不能长期持有 user、project 或凭证锁。

## 9. API 契约

基础路径 `/api/v1`，P=`/projects/{project_id}`，V=`P/variants/{variant_id}`，E=`V/environments/{environment_id}`，B=`P/branch-creations/{creation_id}`。ID/版本字符串、Cookie/CSRF、严格 JSON、error.details、no-store 沿用 [API 约定](api.md)。对象不存在、不属父对象或无项目可见权限返回 404；项目可见但无管理权返回 403。

### 9.1 配置与本地预览

| 方法与路径 | 内容 / 条件请求 |
| --- | --- |
| GET P/branch-model | 七条规则、类型说明、固定环境资格、etag、repository_connections（项目已关联仓库涉及的连接 ID/名称） |
| PUT P/branch-model | `{rules:[...],impact_token?:string}`；模型 If-Match，整体替换 |
| POST P/branch-model/preview | `{rules:[...],sample_names:[...]}`，最多 50 个名称；返回分类、影响对象、impact_token；模型 If-Match |
| GET / POST P/variants | 列表 / 创建 custom；POST 使用产品分支集合 If-Match |
| GET / PATCH / DELETE V | 详情 / 修改 / 删除；写用对象 If-Match，DELETE 另加集合 X-Collection-If-Match |
| POST V/archive、V/restore | `{}`；对象 If-Match |
| GET / POST V/environments | 列表 / 新建；POST 使用环境集合 If-Match |
| GET / PATCH / DELETE E | 详情 / 修改 / 删除；对象 If-Match，DELETE 另加环境集合标签 |
| GET V/repositories、E/repositories | 全量本地求值后分页，含 scope_token、match_sources 和诊断投影；无网络 |
| POST P/repository-scope-preview | `{variant_id?:string,repository_scope:{...},subject_kind:variant|environment}`；环境预览必须指定 variant；返回分页范围及 scope_token，无写入/网络 |

模型 rules 每项为 `{branch_type,enabled,rule:{mode,pattern}|null}`，映射到 SQL 的 rule_mode/rule_pattern；type label、说明、allow_environment 仅由 GET 类型元数据提供，禁止写入。sample_names 分类返回 `{name,git_valid,matched_types,binding_validity,reason}`，不访问远端。

产品分支 POST：`{code,name,summary,main_branch,repository_scope}`，kind 强制 custom。PATCH 仅接受 name、summary、main_branch、repository_scope；环境 POST 为 `{code,name,summary,branch_type,branch_name,repository_scope}`，PATCH 不接受 code、variant_id。PATCH 范围整体替换，不做 JSON 数组下标补丁。创建或修改分支字段时必须通过当前本地规则；仅改名称/摘要/范围可保留既有 invalid 绑定并明确返回其状态，不能借此提交新的非法分支。远端存在性不作为配置保存条件。

产品分支详情返回 `{id,project_id,code,name,summary,kind,main_branch,main_branch_type,repository_scope,archived_at,binding_validity,etag,environments_version,created_by_user_id,created_at,updated_at,can_manage}`；main_branch_type 从 kind 派生。环境详情返回对应身份、资料、branch_type/branch_name、范围、校验有效性和 etag。范围结果每项返回 id（项目仓库关联 ID）、connection_id/connection_name、full_path、match_sources、诊断及 outdated；只提供脱敏字段。批次详情含 variant 名称快照、target_branch、status、派生 expired、各项状态计数、expires_at、etag、can_execute、can_reconcile；计数实时聚合 items，不另存可漂移的成功数。

列表 page 默认 1，page_size=10/20/50/100 默认 20，q 最多 100 码点；variant 支持 archived=active|archived|all 默认 active，按 standard 优先、ID 升序；环境按 ID 升序。所有分页参数也适用于范围预览，响应为 items/total/page/page_size。创建返回 201，修改返回 200，删除 204；返回对象 etag 和受影响集合 X-Collection-ETag。

对象写标签命名空间为 branch-model、project-variant、project-environment、branch-creation；集合为 project-variants、variant-environments。服务端生成完整强 ETag（含引号），客户端不拼接、不混用。列表返回 mutation_version；对象读取返回 etag。聚合展示的诊断和实时范围不算配置版本，API no-store，不把编辑 ETag 当作完整表示缓存验证器。

### 9.2 远端校验与创建

| 方法与路径 | 内容 / 结果 |
| --- | --- |
| POST V/check-branches、E/check-branches | `{repository_ids:[...],scope_token}`，对象 If-Match；逐仓库结果和统计；部分失败仍 200 |
| POST V/branch-creations | `{repository_ids:[...],default_source_branch,source_overrides:[{repository_id,source_branch}],scope_token,retry_of_id?:string}`；产品分支 If-Match、Idempotency-Key；201 返回 prepared 计划 |
| GET P/branch-creations | 按 variant_id/status 筛选、分页，时间/ID 降序；包含已删除产品分支历史 |
| GET B | 计划/批次摘要、etag；不暴露内部凭证快照 |
| GET B/items | 分页明细，含预览、action、status、公开 reason、提交 ID、时间 |
| POST B/execute | `{items:[{id,action:create|use_existing|skip}]}`；批次 If-Match；200 返回已完成或部分/中断结果 |
| POST B/reconcile | `{item_ids:[...]}`；批次 If-Match；只核实 unknown 项，不创建；200 返回观察结果 |

配置和批次响应必须带 can_manage、can_execute 等按当前身份/状态计算的 UI 提示，服务端仍独立授权。成员 DTO 显示创建者、时间、仓库路径与分支/提交和受控结果，不含凭证快照。执行重放返回 200 和当前批次摘要（可能仍为 executing）；HTTP 超时后客户端 GET 核实，禁止自动再发 execute 或新建计划。

配置请求体默认 64 KiB；两个范围选择器不在一个请求重复提交。模型影响清单使用 page/page_size 分页，impact_token 覆盖全量，不用截断内容表示全部。规则预览需要模型 If-Match；纯范围预览不要求写标签。未保存草稿的范围 token 只标识预览，保存后应重新 GET 已保存主体的范围，再将其 scope_token 用于远端动作；配置保存使用 If-Match 并事务内校验父范围，不接受草稿 token 代替写版本或管理权限。

### 9.3 错误

| HTTP | 主要 code |
| --- | --- |
| 409 | PROJECT_ARCHIVED、VARIANT_ARCHIVED、STANDARD_VARIANT_PROTECTED、VARIANT_HAS_ENVIRONMENTS、BRANCH_TYPE_REFERENCED、RULE_CHANGE_IMPACT、BRANCH_OPERATION_IN_PROGRESS、PLAN_EXPIRED、IDEMPOTENCY_CONFLICT、STATE_CHANGED、NAME_CONFLICT、CODE_CONFLICT |
| 412 / 428 | VERSION_CONFLICT / PRECONDITION_REQUIRED |
| 422 | VALIDATION_FAILED（rule_invalid、branch_name_invalid、branch_unclassified、branch_ambiguous、branch_type_mismatch、environment_branch_type_forbidden、repository_out_of_scope）、CAPABILITY_UNSUPPORTED |
| 429 | RATE_LIMITED |
| 502 / 504 | 仅整个远端准备无法建立有效结果时使用受控远端错误 / REMOTE_TIMEOUT；逐项失败放 item |

远端 item reason 包括 system_preferred_required、credential_unavailable、connection_disabled、authentication_failed、access_denied、repository_unavailable、source_missing、target_exists、remote_archived、timeout、invalid_response、state_changed、budget_exceeded、interrupted。不泄露其他项目 ID、原始响应、秘密或内部 URL。额外受控 reason 包含 target_exists_or_rejected、remote_unavailable、rate_limited、connection_unavailable、invalid_request；后续新增 reason 须同步客户端。

## 10. 前端交互

- 项目统一导航中的“产品分支”进入产品分支列表，“设置 → Git 分支规则”维护 Git 分支模型。工作区内项目管理员可直接管理；系统管理员在有权限的项目入口也可管理，不照搬旧仓库管理只能从控制台进入的限制。
- 模型页按七类展示开关、固定语义、单条规则输入和模式选择；测试面板展示具体名称的匹配类型及歧义。regex 为高级模式并提供语法说明，不提供多规则增删按钮或流程 Markdown 编辑器。
- 产品分支入口使用服务端分页列表，显示标准版标识、名称/编码、主干、仓库数量、环境数量及状态；标准版优先。按名称或编码搜索，状态默认正常，可选归档/全部；每页默认 20，可选 50/100。更多菜单收纳编辑、归档、恢复、删除，空项目仍显示标准版。
- 点击名称进入独立详情，返回列表保留搜索、状态、页码及每页条数（路由查询参数保存）。详情保留项目统一导航，以短路径和产品分支名称建立层级，二级导航依次为“仓库与分支”“环境”“发布”；未指定 `vview` 时默认进入“仓库与分支”，显式 `vview=repositories` 继续有效，环境链接使用 `vview=environments`，发布链接使用 `vview=releases`。切换产品分支同样默认进入仓库与分支，不要求先创建环境。
- 详情提供资料、仓库范围、环境、分支创建记录；环境详情显示固定 Git 分支、范围和逐仓库校验。详情的产品分支切换器按名称/编码查询、分页加载，不一次加载全部产品分支；切换列表包含归档标识。窄屏使用纵向列表，页码控件有界显示。项目级“仓库”管理关联资源，产品分支级“仓库与分支”管理所选范围内的分支工作，两者保持不同职责。
- 仓库范围优先 all/inherit，custom 展示手选列表与规则条件；预览按手动/规则来源解释结果，提示父范围缩小可能使旧手选项失效，保存前须清空或重新选择。列表变化后重新获取范围，不静默使用旧勾选执行。
- 不把远端未知涂成成功或失败；显示具体检查时间与过时标识。0 仓库、0 匹配、未校验、失败、归档各有独立文案。显示“存在”不表示已经部署或可创建。
- 批量创建独立面板按“选择仓库与来源→预览→确认执行→结果”组织；展示目标固定名、来源逐项覆盖、提交 ID、已存在采用选项、失败原因。执行中不允许重复提交，返回页面仍能查看历史。
- 删除、归档、改变主干、规则影响确认、批量远端创建均展示具体对象和影响，远端创建采用显式确认按钮。取消准备或关闭预览不执行创建。
- 双主题、桌面缩放、键盘焦点、长路径/中文名、未保存草稿沿用 [UI 规范](ui-design.md)；布局按内容设计，原型不入 Git。没有 Agent 文档或构建占位入口；发布页面见发布管理契约。

## 11. 模块、迁移与审计

业务包 `internal/modules/projectdelivery`、HTTP 注册 `internal/server/project_delivery.go`、MySQL 仓储 `internal/store/mysql/project_delivery.go`、前端 `web/src/features/delivery`。通过仓储/UnitOfWork 端口依赖 collaboration 授权和 integrations 的受控分支能力，模块不自行读取密文或拼接平台 URL。

GitLab 映射：GetBranch 使用 `GET /projects/:id/repository/branches/:branch`，404 时按第 6 节用 `GET /projects/:id/repository/branches?per_page=1` 探测读取能力；CreateBranch 使用 `POST /projects/:id/repository/branches`，传 branch 和冻结的 commit 作为 ref。分支名包含 `/` 时作为单一路径参数正确编码，不使用 path.Join 改写名称；复用连接基础地址、子路径、TLS/CA、DNS/IP 校验、禁止重定向、限流、响应大小限制。平台响应白名单解析，不存作者邮件和提交正文。含 `/`、Unicode、保护规则及部署版本的实际兼容性需要适配器和真实实例验收。

初始迁移直接建立七张表；新建项目在同一业务事务创建 model、七条规则和标准版，不联网、不创建 Git 分支、不修改仓库 default_branch，沿用项目创建审计。

初始化完整性要求每项目 model、七规则、一个标准版均存在；GET 不懒写。启动校验每项目初始化完整性，不允许半初始化版本开放写入。迁移失败按安装恢复规则处理，不提供自动 Down。

审计记录模型更新（字段/规则变更）、产品分支/环境创建编辑删除归档恢复、创建计划执行及逐项结果、显式采用既有分支和人工核实。保存 actor、project/variant/environment/batch/item IDs、名称/分支快照和受控结果；不保存凭证、远端正文或完整请求。纯预览与单纯查询不写业务审计，规则影响确认与远端执行写入审计。校验仅维护最近结果和受控访问日志。

## 12. 验收清单

以下为持续回归要求，不代表每一故障注入或真实平台场景都已覆盖：

- 七类型启用与单规则、零启用拒绝、主线引用保护、exact/glob/regex 全串匹配、Unicode/大小写、非法 Git 名、`**` 跨层与歧义、归档绑定规则影响。
- variant/环境归属、标准版唯一且不可删归档、名称/code 唯一语义、同分支多环境、主干变更不改环境、删除无远端副作用。
- 全量匹配后分页、跨连接同路径、手动与规则并集、父子范围交集、零匹配、路径同步、解除清理、重新关联新 ID、旧 scope_token 拒绝外发。
- 项目/系统管理员、普通及团队成员、团队管理员不升级、失权并发、系统凭证不泄露；原仓库关联权限保持不变。
- exists/missing/unknown 的区分、仓库 404 不当成分支缺失、断网/认证/限流/归档、检查回写排序与过时、不因普通 GET 发网络。
- 源分支移动后使用冻结提交、来源覆盖、目标已存在采用、预览后目标变化、受保护目标、远端归档、并发创建冲突、部分成功、同 key 重放不外发。
- 响应丢失/5xx/本地回写失败/进程崩溃、lease 恢复与迟到响应条件更新、GET 到期计划无写入、unknown 人工核实、重试新计划、旧目标禁止重试、用户撤权与归档期间只记事实不再外发。
- MySQL 8.0/8.4 空库 DDL、带数据迁移、slot 唯一索引、NULL 行为、逻辑引用清理、事务回滚和锁顺序；无物理外键/CHECK；DDL 阅读副本与迁移一致。
- 前端相关类型检查、lint、格式、组件测试、构建与真实浏览器交互；Go 相关/全量测试及 CI 同系列版本的 `golangci-lint config verify`、`golangci-lint run`。

## 13. 参考资料与验证边界

参考入口：[Git 引用名称规则](https://git-scm.com/docs/git-check-ref-format)、[Go regexp 语法](https://pkg.go.dev/regexp/syntax)、[GitLab Branches API](https://docs.gitlab.com/api/branches/)。这些资料支持名称校验、语法选择和 API 映射；本产品的规则语言、权限、批量恢复及数据模型是本文自己的设计。

术语选择参考 [IBM ELM 的 variant](https://www.ibm.com/docs/en/engineering-lifecycle-management-suite/lifecycle-management/7.1.0?topic=hierarchy-creating-variant-by-branching)。本产品采用 variant 表示产品差异，不宣称环境归属层次是外部工具的统一标准。

当前版本已完成本地配置、页面、迁移和有限远端操作实现。MySQL 8.0/8.4 与受控 GitLab HTTP 模拟服务用于验证；未在用户真实 GitLab 仓库创建分支，保护规则及实例版本兼容仍需实际实例验收。完整验证记录见开发说明。
