# 前端实现与维护

AntCDP 的前端是嵌入 Go 二进制的 React SPA。浏览器从根路径加载应用，通过同源 `/api/v1` 使用现有 Cookie 会话、CSRF 与权限接口。本文描述当前代码和维护契约；视觉与操作规范见 [UI 设计规范](ui-design.md)，字段和业务规则仍以所属领域文档为准。

## 1. 技术栈与目录

当前技术栈为 React 19、TypeScript 7、Vite、Tailwind CSS 4、React Router、TanStack Query、TanStack Table、Radix/shadcn 风格本地组件、Base UI Number Field、Lucide 与 Zod。

TypeScript 7 的原生编译器通过 `@typescript/native` 提供 `tsc`。由于 TypeScript 7.0 不提供旧编译器 API，`typescript` 别名使用 `@typescript/typescript6`，供 typescript-eslint 调用；业务源码始终通过 TS 7 strict 检查。两个编译器的版本均锁定在 `web/package-lock.json`。

```text
web/src/
├── api/                 # 同源请求、CSRF、响应和结构化错误
├── app/                 # 安装/身份入口、主题、应用壳和路由边界
├── components/          # 无业务权限判断的基础与平台组件
├── domain/              # 共享校验、状态文案、纯业务判断和服务目录
├── features/            # 访问、工作区、交付、控制台和各消息模块
├── hooks/               # 查询、写入、表单、筛选和未保存保护
├── lib/                 # 路由、时间、最近访问和通用辅助函数
├── styles/              # 语义令牌与全局样式
└── types/               # 与服务端 DTO 对应的前端类型
```

组件不读取 `.agents` 或其他本地原型文件。Logo 和服务品牌资源位于 `web/public`；通用操作图标只使用 Lucide。

## 2. 路由与访问边界

使用 History Router 和真实字符串 ID。登录、注册和强制改密校验同源 `return_to`；只允许已登记的业务路径，不接受外部地址、反斜杠或控制字符。Go 继续通过既有 `/next/` 兼容入口跳转，浏览器保留查询参数和片段。

| 页面或流程 | 正式路由 |
| --- | --- |
| 登录、注册、强制改密 | `/login`、`/register`、`/required-password` |
| 安装与连接异常 | `/setup`、`/connection-error` |
| 工作区 | `/home`、`/projects`、`/teams` |
| 个人设置 | `/account`、`/account/security`、`/account/integrations/{id?}`、`/account/remote-hosts/{id?}` |
| 项目与团队详情 | `/projects/{id}`、`/teams/{id}`；项目页签在查询参数中 |
| 产品分支 | `/projects/{id}/variants`、`/projects/{id}/variants/{variantId}` |
| 项目归属凭证 | `/projects/{id}/integrations/{id?}`、`/projects/{id}/remote-hosts/{id?}` |
| 控制台 | `/admin`、`/admin/users`、`/admin/projects`、`/admin/teams` |
| 控制台对象详情 | `/admin/projects/{id}`、`/admin/teams/{id}` |
| 服务与主机 | `/admin/integrations/{id?}`、`/admin/remote-hosts/{id?}` |
| 消息模块 | `/admin/email/{section?}/{id?}`、`/admin/sms/{section?}/{id?}`、`/admin/dingtalk/{id?}` |
| 系统维护 | `/admin/settings`、`/admin/audit`、`/admin/maintenance` |

项目查询参数保留当前任务和返回上下文：`tab`、`section`、`vview`、`release`、`creation`、筛选和分页。发布链接同时包含项目、产品分支和发布 ID；从列表进入时保留 `return_to`。新增或更换路由必须同步 `lib/routes.ts` 中的 `businessRoute` 和 Vite 的 `ui-build.json` 契约。

前端隐藏入口只改善体验。普通用户、项目管理员和系统管理员的实际权限始终由服务端重新校验；工作区查询 `scope=mine`，控制台查询 `scope=all`，系统管理员也不能在个人工作区借此看到未参与对象。

## 3. 请求与缓存

`api/client.ts` 统一处理：

- 同源 `fetch`、`cache: no-store`、JSON 和 multipart 请求体。
- 写操作先取得 `/auth/csrf`，发送 `X-CSRF-Token`；登录、退出、安装和改密后重新生成客户端令牌状态。
- `ETag`、`X-Collection-ETag` 和分页外壳；按接口要求发送 `If-Match`、`X-Collection-If-Match`、`Idempotency-Key` 和专用确认头。
- `error.code/message/details`、`request_id`、HTTP 状态和 `Retry-After`。
- 401 与强制改密跳转；503、数据库异常和安装状态不混为空数据。
- 网络中断、无有效响应外壳等写入不确定性使用 `uncertain=true`，不能显示为已确认失败。

TanStack Query 管理查询、取消、缓存失效、窗口聚焦刷新和加载/错误状态。Query Key 包含资源归属、ID、筛选和分页。GET 只允许有限重试；Mutation 一律不自动重试。创建、远端写入或本地落盘结果未知时，先读取相应列表、对象、操作或日志核实。

## 4. 版本与恢复语义

不同令牌不得混用：

- 用户、资料、连接和发布对象使用自己的强 ETag。
- 成员、仓库、凭证和产品分支集合使用各自的集合版本。
- 首选与兜底资源使用独立版本，删除凭证还可能同时需要对象和集合版本。
- 产品分支范围使用 `scope_token`，分支创建计划使用批次 ETag。
- 发布验收和归档同时绑定当前 `manifest_id` 与清单摘要。
- 规则影响确认、冻结预览和临时文件候选使用各自专用令牌。

412/428 保留草稿并提示重新读取；409 按占用、生命周期、名称或状态原因呈现；422 将字段错误关联到控件并聚焦首个错误；429 展示等待时间。弹窗和抽屉关闭、应用内导航、刷新或关闭标签页分别保护未保存内容。关闭页面不代表后台任务仍在执行。

## 5. 页面与领域组件

### 工作区与协作

首页以关注项目卡片和固定团队为双栏工作台，并根据最近访问或关注顺序选择一个当前项目，展示真实发布与待核实操作。项目和团队使用各自独立的 ID 映射，避免相同数字 ID 混淆。我的项目、我的团队、团队详情、项目总览、发布列表、只读仓库、成员与团队、介绍和项目设置均使用真实 API。项目创建使用分步抽屉，支持多初始管理员、图标裁剪和 Markdown 简介；成员来源、直接角色、团队授权和生命周期操作分开呈现。

项目总览依次呈现当前发布、六阶段进度、仓库/产品分支/发布/待核实摘要、活动产品分支和进行中发布；发布详情共享同一阶段卡。项目页签导航位于左侧，项目资料编辑和退出入口保留在总览与项目设置中，不在每个子页面重复项目标题。

关注项目与固定团队通过 `/me/sidebar-shortcuts` 整组保存并排序，使用分组 ETag 处理多设备冲突。最近访问仅在本标签页 sessionStorage 保存名称、类型和同源路由，不作为实时业务数据。

### 仓库与交付

仓库选择器支持连接、分组、搜索、游标和跨页选择；批量同步逐仓显示成功、失败与未知。产品分支模块实现七类 Git 分支规则、影响预览、环境、动态范围、远端校验和分支创建批次。创建计划冻结来源提交，执行前逐项确认创建、采用或跳过，未知项先只读核实。

发布工作区分为本次变更、交付材料、送验清单和操作记录。覆盖范围/基线、MR、直接提交、回退、冻结、验收、退回、终止、Tag、归档、ZIP 和材料历史。材料支持 SQL、对象、配置和附件，保留修订、SQL 排序、下载与冲突恢复。

### 服务、主机与消息

服务目录只展示后端声明且前端已适配的 GitLab、Jenkins、OpenObserve、Elasticsearch、MySQL 和 PostgreSQL。连接创建采用独立分步页面，连接与凭证分别记录创建结果。GitLab Webhook 只验证接收，不宣称触发工作流。

SSH 主机使用独立页面与请求路径，支持公钥探测、指纹核对、显式信任、归属凭证和诊断，不提供终端、命令执行或文件传输。

邮件、短信和钉钉保持独立业务组件：邮件包含 SMTP、发件名称、模板、隔离预览、附件和日志；短信区分远端模板与本地模拟；钉钉只提供文本/Markdown 测试。`accepted` 只表示服务端或供应商受理，不表示送达或已读。

## 6. 表单、Markdown 与文件

Zod 用于共享字段规则、表单 Schema 和认证响应边界。密码按 Unicode 码点与 UTF-8 字节分别校验；ID 始终是字符串。秘密只保留在当前编辑状态中，不进入 localStorage、URL、日志或普通详情响应。

头像和图标在本地裁剪为 256×256 PNG 后上传，支持拖动、缩放、旋转、重置和键盘微调；保存所属资料后才绑定。项目介绍使用 CodeMirror 编辑、预览和分栏，Markdown 禁用原始 HTML 与远程图片；代码使用按需 Shiki 高亮，Mermaid 在 strict 模式下清理 SVG，并提供复制、缩放和平移。

## 7. 开发、检查与发布

使用仓库支持的 Node.js 版本，CI 使用 Node.js 24。开发命令：

```sh
node scripts/build-web.mjs
go run ./cmd/antcdp serve --listen 127.0.0.1:8080 --public-url http://localhost:8080
```

需要 Vite 热更新时，将后端公开来源设为 `http://127.0.0.1:5173`，再运行 `node scripts/dev-web.mjs`。代理目标可由 `ANTCDP_DEV_BACKEND` 调整。

标准检查：

```sh
node scripts/build-web.mjs
node scripts/check-web.mjs
node --test scripts/*.test.mjs
go test ./...
go vet ./...
golangci-lint config verify
golangci-lint run
```

前端测试位于现有 `web/tests` 和 Vitest 配置中，覆盖协议、注册、安装、路由、主题、恢复规则和组件行为。浏览器验收还需覆盖真实会话、深浅主题、键盘、长内容、版本冲突及复杂流程。受控模拟不能代替真实 MySQL、GitLab、SMTP、短信供应商、SSH 或钉钉联调；未完成项必须明确报告。

构建从锁文件安装依赖，检查 TypeScript 并生成 `web/dist`。`scripts/verify-web.mjs` 验证根入口、路由清单、静态资源和图标。Go 通过 embed 嵌入产物，运行容器不需要 Node 或前端源码。
