# 架构与模块边界

AntCDP 采用模块化单体：一个 Go 进程、一个 MySQL 数据库、一份本地持久化目录；React SPA 与 API 同源部署。运行状态、开发方法与限制见 [开发指南](../development/getting-started.md)。

## 技术栈与交付

| 层次 | 当前选择 | 边界 |
| --- | --- | --- |
| 后端 | Go、Gin | HTTP 层处理协议和认证上下文，业务规则归所属模块 |
| 存储 | MySQL 8.x、InnoDB、utf8mb4 | 支持 8.0.17 起的 8.x；不承诺 MariaDB 或其他数据库兼容 |
| 数据访问 | database/sql、go-sql-driver/mysql、sqlx | 手写 SQL、显式事务；驱动句柄不进入模块接口 |
| 迁移 | Goose、go:embed | 单一初始基线及后续增量迁移；无 ORM 自动改表 |
| 前端 | React 19、TypeScript 7、Vite、React Router、TanStack Query | 按功能装配页面，通过同源 `/api/v1` 访问服务；查询与 Mutation 分开管理重试 |
| UI | Base UI、本地组件、Tailwind CSS 4、TanStack Table、Lucide、Zod | 基础组件和平台组合共享，业务组件归各模块；表格逻辑、图标与校验各司其职 |
| 身份 | bcrypt、数据库会话、HttpOnly Cookie、CSRF | 不使用 JWT 或 Redis；权限由服务端校验 |
| 文件 | 本地目录与小范围存储接口 | 头像、业务图标、智能体文件及临时文件；无对象存储适配 |
| 日志 | log/slog | 结构化运行日志与业务审计分离，不记录秘密 |

依赖版本以 `go.mod/go.sum` 和 `web/package-lock.json` 为准。构建先生成 `web/dist/`，再将 SPA 与 SQL 迁移嵌入二进制；运行容器不包含 Node、Go 工具链或源码。默认构建使用 CGO_ENABLED=0。采用理由见 [技术决策](decisions.md)。

## 运行结构

```mermaid
flowchart LR
  Browser[React SPA] --> HTTP[Gin / 同源 API]
  HTTP --> Modules[应用模块与授权]
  Modules --> Store[MySQL 仓储 / UnitOfWork]
  Store --> DB[(MySQL)]
  Modules --> Files[本地文件存储]
  Modules --> Adapters[受控外部服务适配器]
  Files --> Data[持久化数据目录]
  Adapters --> Remote[GitLab / SSH / 消息供应商等]
```

当前只支持单应用实例。数据库会话不消除进程锁、内存限流、维护循环和本地文件的单实例边界；不同数据卷也不能作为同一安装的多副本方案。

## 实际模块

| 模块 | 职责 |
| --- | --- |
| install | 空库检查、迁移、种子、安装身份、主密钥、完成标记与恢复 |
| identity | 用户、本地密码、会话、系统身份及共享业务授权事务 |
| settings / audit | 受控系统设置与只读审计查询 |
| media | 头像与图标处理所需的文件规范化、存储与回收能力 |
| collaboration | 项目、团队、成员来源、业务角色、图标与快捷方式 |
| integrations | 服务连接、凭证、Webhook、平台适配器、项目仓库关联及标签 |
| remotehosts | 独立 SSH 主机、公钥信任、凭证和诊断 |
| models | 提供商、模型定义、加密凭据、幂等命令及持久诊断操作 |
| modelcore / modeladapters | 独立模型契约、参数目录、受控 HTTP/SSE、原生历史与用量 |
| agentadapters/eino | 嵌入 Go 的受控模型与工具循环；宿主钩子负责持久化和授权 |
| agentcore | 不依赖平台、SQL、Gin 或 Eino 的执行端口、调度、事件、模型上下文、交互、压缩及预算规则 |
| agents / agentresources | 平台身份与资源授权、会话和运行事务、观察与元数据、MCP/技能管理及私有字节生命周期 |
| sandboxcore / sandboxadapters/opensandbox | 与平台和 SQL 独立的生命周期、进程、文件传输及网络策略契约；OpenSandbox Docker 适配 |
| workspacefs / cmd/antcdp-workspace-helper | 镜像内可信文件协议与 Linux 安全 IO；平台在 agents 内协调权限、持久意图、引用和恢复 |
| agentadapters/mcp | HTTP MCP 协议、受控网络、运行时发现与参数/结果校验；管理员同步测试/调试；不控制远端资源范围 |
| webaccess / webaccessadapters | 与智能体并列的搜索/读取契约、有限路由切换和供应商/HTTP 读取适配 |
| modules/webaccess / skillpackage | 检索提供商管理与凭据；独立技能 ZIP 校验与按需读取 |
| email / sms / dingtalk | 三套独立配置、模板或测试用例，不合并为消息业务包 |

模块使用稳定用户 ID 关联。系统身份与项目/团队角色独立；团队管理员不会自动成为项目管理员。仓库关联、标签和凭证维护各自校验权限及凭证选择规则，不提供通用执行授权链。

## 源码组织

```text
cmd/antcdp/                 # 程序入口
internal/app/              # 生命周期、装配、维护循环
internal/server/           # 路由、中间件、DTO 协议与 SPA 边界
internal/modules/          # 上述业务模块
internal/store/mysql/      # sqlx 仓储、事务适配器与私有行结构
internal/store/migrations/ # 嵌入式 SQL
internal/platform/         # 配置、加密、文件、密码、HTTP 基础设施
internal/agentcore/        # 通用执行核心及小范围宿主端口
internal/agentadapters/    # Eino 与 MCP 适配
internal/webaccess/       # 独立网络检索运行契约
internal/webaccessadapters/ # 检索供应商和内置 HTTP 读取
internal/skillpackage/    # 无执行能力的技能包校验与按需读取
internal/sandboxcore/      # 独立沙箱契约与网络规则编译
internal/sandboxadapters/  # OpenSandbox Docker 适配
internal/workspacefs/      # 可信 helper 协议与 Linux 实现
cmd/antcdp-workspace-helper/ # 镜像内固定入口
docker/sandbox/           # 工作空间镜像与控制组件兼容补丁
web/src/app/               # 公共入口、身份、跨区域服务与路由装配
web/src/areas/             # 控制台、工作区、个人中心的独立应用壳与页面
web/src/features/          # 公共访问流程、共享业务能力与领域控件
web/src/components/        # 基础组件与平台组合
web/src/api/               # 同源请求、CSRF、错误与条件写入
web/src/domain/            # 共享校验与纯业务规则
web/src/hooks/             # 查询与通用 React hooks
web/src/types/             # DTO 类型
web/src/styles/            # 语义变量与全局样式入口
scripts/                   # 构建与验证
```

## 依赖与事务

- HTTP Handler → 应用服务 → 领域规则/仓储端口 → MySQL、文件及网络适配器；Handler 不直接处理 SQL 或授权规则。
- 用例通过所属模块的小范围仓储/事务接口协作，适配器绑定同一事务；不建立全站通用 CRUD 或巨型 Repository。
- SQL 使用显式列名、私有行结构和绑定参数；动态字段与排序来自白名单。查询有分页或上限，不使用 Unsafe() 掩盖映射问题。
- 敏感写入在事务内重新验证账号、权限、状态和版本，业务数据与审计原子提交。跨模块锁序及重试由各用例契约规定。
- 网络调用和大文件 IO 不持数据库锁。先记录意图或快照，再执行外部操作，最后按实际结果记账；未知结果不能自动当作失败重发。
- 维护循环处理会话/媒体清理、消息日志与中断状态等过期状态，不承担通用工作流调度。过期判断不依赖清理准时执行。

## 身份、文件与安装

用户密码使用 bcrypt，与系统主密钥分离。会话数据库只保存随机令牌的 SHA-256，校验账号状态、auth_version、撤销及过期时间；完整规则见 [身份与权限](../domains/platform/identity.md)。同源写操作受 CSRF 保护，代理信任由部署配置限定。

32 字节主密钥保存在私有数据目录，通过用途派生和资源绑定 AAD 加密配置及外部秘密；普通 API 不读取秘密。文件先暂存，事务管理元数据和绑定，回收确认没有有效引用。自动密钥轮换、KMS 和对象存储尚未实现。

安装、迁移、种子事务和文件完成标记分步执行；MySQL DDL 不具备整次安装回滚能力。serve 只检查版本和结构，db migrate 是显式维护命令。安装身份及完整数据目录必须与数据库匹配，详见 [部署与维护](../operations/deployment.md)。

## 前端与扩展

公共装配与区域代码分离；控制台、工作区和个人中心共享身份、请求协议与业务能力，统一构建为同源 SPA。路由守卫不能替代 API 授权。技术栈、工程边界和开发方法见[前端文档](../development/frontend.md)。

受控 KV 仅保存低频配置；项目、仓库、标签、凭证和智能体执行等实体拥有独立表。Webhook 只验证接收，审计不是队列。通用智能体在同仓库同 Go module 内保持依赖独立，由 `app` 装配平台授权、MySQL、模型、工具和事件端口，不引入独立执行服务。外部登录、其他存储引擎、通用调度、Graph 工作流及业务触发接入尚未实现；扩展要求见 [扩展边界](extensibility.md)。
