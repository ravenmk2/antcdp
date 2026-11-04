# 开发指南与能力边界

AntCDP 是单租户、自主部署的模块化单体。一个 Go 进程提供 React SPA 和同源 API，使用 MySQL 与本地持久化目录。产品中的 AI Native 定位不代表已实现 Agent 或工作流执行。

## 当前能力

| 领域 | 已实现能力 | 主要限制 |
| --- | --- | --- |
| 安装与身份 | 安装向导、安装恢复、用户与创始人保护、注册、会话、强制改密、头像 | 无邮箱身份、邮件找回、外部登录或 MFA；无遗失密码恢复 CLI |
| 系统管理 | 受控设置、审计查询、临时文件预览与手动清理 | 不提供任意 KV 编辑、审计删除或通用任务调度 |
| 项目与团队 | 资料、图标、成员、团队授权、归档/解散、个人快捷方式 | 无自定义角色；选择器最多 50 项，无选择器分页 |
| 项目仓库 | GitLab 多仓库关联、组浏览、搜索、同步与解除 | 关联维护仅系统管理员；无 Gitea 适配、代码浏览或定时同步 |
| 产品分支与环境 | 七类 Git 分支规则、仓库范围、远端校验、主干创建与结果核实 | 无模板库、通用 Git 客户端或 Agent 文档管理 |
| 发布管理 | 草稿、材料修订、MR 合并与回退、冻结送验、退回、Tag、归档 ZIP | 远端写入使用本人首选凭证；未知结果需核实，不自动重发 |
| 服务集成 | GitLab、Jenkins、OpenObserve、Elasticsearch、MySQL、PostgreSQL 连接及凭证验证 | Webhook 仅验证接收；不提供任意 SQL、检索或 Jenkins 构建执行 |
| 远程主机 | SSH 主机、公钥信任、三种认证方式及诊断 | 无命令执行、终端、SFTP、跳板机或 sudo |
| 邮件、短信、钉钉 | 各自独立配置与显式发送测试；邮件/短信模板和 30 天日志 | 无业务触发、订阅、投递队列、自动重试或送达保证 |

接口和权限以所属模块文档为准。当前数据库基线为版本 1，共 48 张业务表，运行文件为 `internal/store/migrations/mysql/00001_initial.sql`。安装要求空库；后续结构变化追加版本迁移，普通启动不自动改表。

## 本地启动

使用 `go.mod` 指定的 Go 工具链、Node.js 和 npm；CI 使用 Node.js 24，允许的 Node 版本范围以 `web/package.json` 的 engines 为准。以下命令在仓库根目录执行，适用于 PowerShell 与常见 Unix shell：

```sh
node scripts/build-web.mjs
go run ./cmd/antcdp serve --listen 127.0.0.1:8080 --public-url http://localhost:8080
```

打开 `http://localhost:8080` 完成安装。准备 MySQL 8.0.16 及以上的 8.x 专用空库、utf8mb4 字符集和具有该库初始化权限的应用账号；应用不会创建数据库或账号。不要导入 `docs/schema.sql`。

数据目录默认 `<cwd>/data/`，可通过 `--data-dir` 指定。公开来源必须与浏览器实际访问地址一致。安装成功最后写入 `install.lock`；配置、密钥或数据库异常不会重新开放安装。状态和维护命令见 [部署文档](deployment.md)。

前端热更新时，后端的公开来源设为 `http://127.0.0.1:5173`，监听 8080，再在另一个终端运行：

```sh
node scripts/dev-web.mjs
```

Vite 将 API 与健康检查代理给 Go，后端地址可用 `ANTCDP_DEV_BACKEND` 调整。组件与路由规则见 [前端文档](frontend.md)。

## 字体与构建产物

构建脚本按锁文件安装依赖、校验 TypeScript、准备 MiSans 并生成 `web/dist/`。字体来源、许可和 SHA-256 锁定在 `web/fonts.lock.json`，下载结果缓存在 `web/.cache/fonts/`。缓存缺失或损坏时重新下载，不能校验时构建失败；不自动接受上游变化。生成字体随 SPA 嵌入二进制，运行时只从本站加载。缓存与生成目录不进入 Git，不手工修改 `web/dist/`。

## 检查命令

```sh
node scripts/build-web.mjs
node scripts/check-web.mjs
node --test scripts/*.test.mjs
go test ./...
go vet ./...
golangci-lint config verify
golangci-lint run
```

golangci-lint 使用 `.github/workflows/test.yml` 固定的版本及仓库 `.golangci.yml`；当前为 2.13.2。支持 CGO 的工具链可运行 `go test -race`，不能把未运行的竞态检查标为通过。

前端检查覆盖 ESLint、Prettier、组件测试、字体和产物引用。Go 检查覆盖领域、协议、安装恢复、文件及加密等行为；模拟存储不能证明 MySQL DDL 和事务正确性。

## MySQL 集成测试

三个环境变量分别指定独立的空测试库，使用 TCP DSN，不共享库：

| 环境变量 | 测试入口 | 覆盖范围 |
| --- | --- | --- |
| `ANTCDP_TEST_MYSQL_DSN` | TestMySQLInstallation | 真实初始迁移、种子事务、非固定创始人 ID、JSON/Unicode 与仓储业务 |
| `ANTCDP_TEST_HTTP_MYSQL_DSN` | TestHTTPIdentityLifecycle | Cookie/CSRF、认证管理、权限、业务模块与实际事务 |
| `ANTCDP_TEST_SCHEMA_MYSQL_DSN` | TestInitialMigration | 单一基线、48 张业务表、无物理 FK/CHECK、重复迁移、错误版本及缺失字段拒绝 |

存储测试接受 `antcdp_test` 或 `antcdp_test_` 前缀，HTTP 和结构测试要求 `antcdp_test_` 前缀。变量未设置时对应测试明确跳过。测试不自动删除已有库，完成后保留结构，再次运行应提供新的空测试库。凭据只通过受控本地环境或 CI 注入，不写入 Git 或普通日志。

```sh
go test -count=1 -v ./internal/store/mysql
```

CI 在 MySQL 8.0/8.4 临时服务上运行实库测试，并在 Linux、Windows、macOS 构建前端和执行 Go 检查。CI 配置本身不构成通过证据。

## 验证边界

基线已在 MySQL 8.0.46、8.4.11 验证完整仓储及 HTTP 生命周期；新装、重复迁移、关键结构校验均有实库覆盖。安装中断的部分故障注入使用内存适配器与临时文件，完整物理备份恢复、生产负载及所有并发组合仍需专项验收。

外部协议主要通过受控 GitLab、SMTP、短信和 SSH 服务验证。模拟通过不等于用户实际 GitLab 权限/版本兼容、真实邮件送达、短信计费或钉钉群消息成功；真实联调使用明确授权的账号和目标。

项目/团队成员分页在合并有效来源后进行，超大规模查询优化、账号删除的逐对象成员审计与完整业务并发压力验证尚未完成。只支持单应用实例，不宣称共享数据库即可多副本运行。

UI 验收遵循 [桌面与操作验收](ui-design.md#桌面与操作验收)，覆盖浅深主题、键盘、焦点、长内容、版本冲突与未知结果。接口成功、静态资源一致或页面可下载不能代替真实浏览器渲染和交互验证；受环境限制未完成的检查必须明确报告。
