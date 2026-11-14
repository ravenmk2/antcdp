# 测试与验证

## 检查命令

本机开发可使用统一入口：

```sh
node scripts/dev.mjs check
node scripts/dev.mjs verified
node scripts/dev.mjs test-db
```

`check` 汇总前后端检查及 CI 固定版本的 golangci-lint 配置验证和代码检查。成功记录绑定代码、运行资源、依赖、构建与检查配置及工具链，`verified` 用于确认记录是否仍然有效。`docs/`、根目录 `README.md` 与 `AGENTS.md` 不参与记录失效判断；代码目录中的运行时 Markdown 等资源仍参与。记录不能替代人工验收或未执行的实库测试。

`test-db` 使用开发连接配置创建独立、唯一命名的测试库，执行 MySQL 集成测试，结束后仅删除本次创建的库。不会在开发验收库中执行破坏性测试。清理未完成时保留记录并报告失败，核对处理后再重试。该入口当前不启用竞态检测。

下列细分命令仍可独立执行；实库测试的配置与边界见下文：

```sh
npm ci --prefix web
node scripts/build-web.mjs
node scripts/check-web.mjs
node --test scripts/*.test.mjs
go test ./...
go vet ./...
golangci-lint config verify
golangci-lint run
```

文档链接及 schema 阅读副本通过开发审核维护，不进入 CI 或本机检查脚本。后端结构变更时同步更新阅读副本；实际迁移正确性由 MySQL 集成测试验证。纯文档修改不要求执行代码检查。

golangci-lint 使用公共 [Go 检查 action](../../.github/actions/check-go/action.yml) 固定的版本及仓库 `.golangci.yml`；本机入口读取同一个版本。支持 CGO 的工具链可运行 `go test -race`，不能把未运行的竞态检查标为通过。

前端检查覆盖 ESLint、协议/组件测试和产物引用，构建包含 TypeScript 检查。Prettier 仅供开发时按需运行 `npm run format --prefix web` 或 `npm run format:check --prefix web`，不作为 CI 或默认检查门槛。领域行为按实际接口和对应测试验证，公共测试方法不重复维护字段、页面布局或改造清单。Go 检查覆盖领域、协议、安装恢复、文件及加密等行为；模拟存储不能证明 MySQL DDL 和事务正确性。

## 前端交互测试

使用 Testing Library 的角色、可访问名称与字段标签定位元素，通过 userEvent 执行操作。步骤切换、提交或弹层开关触发异步状态时，等待目标界面的语义标志再继续；公共辅助函数返回前也应完成该等待。

```tsx
await user.click(screen.getByRole("button", { name: "下一步" }));
await screen.findByRole("heading", { name: "确认信息" });
```

需要等待断言成立时使用 waitFor；不使用固定延时、放宽断言或增大超时掩盖时序问题。根据变更验证实际功能及对应业务契约。

## MySQL 集成测试

以下环境变量分别指定独立的空测试库，使用 TCP DSN，不共享库：

| 环境变量 | 测试入口 | 覆盖范围 |
| --- | --- | --- |
| `ANTCDP_TEST_MYSQL_DSN` | TestMySQLInstallation | 真实初始迁移、种子事务、非固定创始人 ID、JSON/Unicode 与仓储业务 |
| `ANTCDP_TEST_HTTP_MYSQL_DSN` | TestHTTPIdentityLifecycle | Cookie/CSRF、认证管理、权限、业务模块与实际事务 |
| `ANTCDP_TEST_MODELS_MYSQL_DSN` | TestModelsLifecycle | 完整基线安装、模型管理协议、认证、诊断与引用约束 |
| `ANTCDP_TEST_AGENTS_MYSQL_DSN` | TestAgentsLifecycle | 完整基线安装、智能体管理、会话、事件、交互、MCP、技能、网络检索与文件生命周期 |
| `ANTCDP_TEST_CLOUD_MYSQL_DSN` | TestCloudBackendResetAndVerifiedDeletion | 独立验证后端切换、稳定会话绑定与卷删除结果核实，避免其他运行中的测试影响全局维护条件 |
| `ANTCDP_TEST_SCHEMA_MYSQL_DSN` | TestInitialMigration | 完整迁移、模块种子、无物理 FK/CHECK、重复迁移保留数据、错误版本及缺失字段/种子拒绝 |

存储测试接受 `antcdp_test` 或 `antcdp_test_` 前缀，HTTP 和结构测试要求 `antcdp_test_` 前缀。变量未设置时对应测试明确跳过。直接运行 Go 测试不会创建或删除数据库，完成后保留结构，再次运行应提供新的空测试库；统一开发入口的 `test-db` 则负责创建和清理本次专用测试库。凭据只通过受控本地环境或 CI 注入，不写入 Git 或普通日志。

实库测试使用当前完整基线和独立空库，已有结构的测试数据库不可复用；部署验收环境还须同时重建配套应用数据，见[部署边界](../operations/deployment.md#数据库基线与安装边界)。

```sh
go test -count=1 -v ./internal/store/mysql
```

开发镜像、[Test](../../.github/workflows/test.yml) 和 [Release](../../.github/workflows/release.yml) 独立触发和执行，不互相调用、等待结果或消费产物。公共 action 仅复用前端构建及 Go 检查步骤，每条流程重新执行自己的步骤。

Test 在 Linux 构建和检查前端一次，只在本次运行内部共享该产物；覆盖 Linux、Windows、macOS 的 Go 与脚本测试，以及 MySQL 8.0/8.4 实库测试。开发镜像只要求前后端构建、资源校验及镜像版本命令冒烟成功，不代表完整 Test 通过。Release 对当前版本标签独立执行前端检查、脚本测试、Go 单测/vet/lint 和 MySQL 8.4 实库测试，再构建发布产物。触发条件和任务配置以工作流为准，CI 配置本身不构成通过证据。

## 验证边界

测试报告应区分静态检查、单元测试、受控服务模拟、MySQL 实库、真实供应商联调和浏览器验收，记录跳过项及原因。CI 配置或模拟通过不等于目标环境兼容。

- 外部 GitLab、SMTP、短信、钉钉、SSH、模型与检索服务需使用获准的账号和目标验证；协议模拟不能证明实际权限、送达、计费或供应商扩展行为。
- 沙箱按[部署验收](../operations/sandboxes.md#验证与验收)核对真实执行、文件、网络、持久卷和恢复；直连、代理、域名、IPv6 和不同网络拓扑分别验证。Linux helper 需要实际执行，Windows 编译不能证明 Linux 安全 IO 语义。
- 静态资源可访问不能代替浏览器功能检查；只读模拟数据不能作为业务成功证据。
- 完整备份恢复、生产负载及并发竞争需专项验证。单应用实例边界见[架构](../architecture/overview.md)，不以共享数据库推定多副本安全。

验证使用独立测试库与临时资源；结束后核对测试实例、后台进程、端口和卷。凭据、环境专属记录及运行日志不进入 Git，正文不维护历次测试流水账。

MCP 验证分为适配器协议测试、模块授权/快照测试、MySQL Server 绑定与诊断测试，以及客户端功能测试/轻量调试。远端模拟端点覆盖完整分页、schema 改变、认证失败、isError、慢响应和断线；确认 tools/call 不因 SDK 或应用恢复而自动重发。模拟端点与调试产物只放 `.data/`，不写入部署信息。

调试增强还需覆盖同连接发现/连续调用、登录隔离、会话失效和资源限制，以及 Schema 示例的完整校验与有界生成；不得用自动生成的示例直接执行未知业务工具。
