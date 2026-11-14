# AI Agents 工作规范

AntCDP：AI Native Team Collaboration & Development Platform

## 目录结构

```txt
antcdp/
├── cmd/antcdp/        # 程序入口
├── docs/              # 指导功能开发的需求、架构、API 与技术约定
├── internal/          # 应用私有代码
├── web/               # 前端源码与构建产物
└── scripts/           # 辅助脚本
```

## 文档用途与审核

- `docs/` 仅用于指导功能开发，维护源码导航、架构关系、开发方法和必要的安全、兼容及恢复边界。功能、接口、字段、默认值及支持范围以代码和测试为准，不重复维护易失效的实现快照。
- 实际环境信息不得写入 `AGENTS.md` 或 `docs/`，包括实际部署目标、主机与连接信息、环境配置、资源清单、环境运维策略及部署记录。这些内容维护在被 Git 忽略的本机配置中；部署环境信息继续维护在 `.agents/skills/remote-deploy/`。通用操作方法可以写入开发文档。
- 对 `docs/` 下任何文件的新增、修改、删除或移动，都必须先向用户提供具体变更内容并经用户审核同意，再落盘执行；不得将一般开发任务授权视为文档修改已获审核。待审方案在对话中展示，不先写入 `docs/`。
- 开发过程中发现文档需要同步时，先整理待审变更；本文件中其他文档同步要求同样遵守上述审核规则。

## 文档入口

完整目录与维护约定见 [docs/README.md](docs/README.md)，不在此重复维护逐篇索引。

- [开发启动](docs/development/getting-started.md)与[测试方法](docs/development/testing.md)。
- [架构与模块边界](docs/architecture/overview.md)。
- [安装与容器部署](docs/operations/deployment.md)。
- [公共 API](docs/api/conventions.md)与[数据库约定](docs/database/README.md)。

## 开发完成验证

开发完成后，按代码影响范围运行相关构建和测试。涉及 Go 代码、依赖或后端构建与检查配置时，使用与 CI 一致的 golangci-lint 版本及仓库 `.golangci.yml` 配置运行 `golangci-lint config verify` 和 `golangci-lint run`，修复全部问题后再交付。纯文档修改无需运行代码检查；文档链接和 schema 阅读副本通过审核维护，不纳入 CI 或检查脚本。若环境限制导致无法完成检查，需明确说明未验证项及原因。

## 本机开发

- 本机开发统一使用 `node scripts/dev.mjs`，具体命令见开发启动与测试文档。优先复用现有服务；编译失败时，即使旧服务仍可访问，也不得视为最新代码已生效。
- 开发数据、日志和临时文件统一放在项目根目录 `.data/`，不进入 Git。使用已配置的数据库，不擅自安装、初始化或启动数据库实例；开发验收库与自动化测试库隔离。初始化异常或环境缺失时报告问题，不自动清库或另建环境。
- 优先使用脚本返回的摘要，失败时按需读取日志。源码及工具链未变化时复用有效检查结果，避免重复调查和重复检查。

## 前端开发与发布

- React、TypeScript、Vite、Tailwind CSS 与 Base UI 在 `web/` 内维护。正式页面使用根路径，同源 API 使用 `/api/v1`。前端技术栈及工程边界见[前端实现与维护](docs/development/frontend.md)。
- 默认在本机完成开发、调试和验收，使用前端热更新及后端源码监听。相关检查与本机验收通过后提交，再按任务要求部署该 commit；日常修改不以远程部署作为验收步骤。开发镜像、Test 和 Release 独立运行，只共享构建与检查步骤，不互相调用或消费产物。开发镜像验证构建与镜像冒烟，Test 承担完整测试矩阵，Release 对版本标签独立执行发布前检查；各自产物与检查必须对应本次运行的同一源码状态，开发镜像成功不代表完整测试通过。

## Git 提交规范

- Git commit 必须遵循 Conventional Commits：`<type>[optional scope]: <description>`，例如 `fix(delivery): clarify product variant terminology`。
- 提交消息使用英文，包括标题及可选正文、页脚；描述具体改动，不使用阶段编号。
- type 按改动语义选择，如 `feat`、`fix`、`refactor`、`docs`、`test`、`chore`；破坏性变更使用 `!` 或 `BREAKING CHANGE:` 标注。
