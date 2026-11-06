# AI Agents 工作规范

AntCDP：AI Native Team Collaboration & Development Platform

## 目录结构

```txt
antcdp/
├── cmd/antcdp/        # 程序入口
├── docs/              # 需求、架构、API、数据库与部署设计
├── internal/          # 应用私有代码
├── web/               # 前端源码与构建产物
└── scripts/           # 辅助脚本
```

## 文档索引

文档入口增删或职责变化时同步索引，完整目录与维护规则见 [docs/README.md](docs/README.md)。

- [docs/README.md](docs/README.md)：分类目录、文档职责与维护约定。
- [README.md](README.md)：产品简介与 Docker 快速开始。
- [docs/development.md](docs/development.md)：当前能力、开发启动、测试方法与验证边界。
- [docs/architecture.md](docs/architecture.md)：运行结构、实际模块、依赖方向与交付方式。
- [docs/technology-decisions.md](docs/technology-decisions.md)：数据访问、密码、数据库的采用理由和限制。
- [docs/extensibility.md](docs/extensibility.md)：设置 KV、凭据隔离、仓储事务接口及未实现扩展。
- [docs/deployment.md](docs/deployment.md)：镜像发布、配置、安装、迁移、恢复与配套备份。
- [docs/frontend.md](docs/frontend.md)：组件职责、路由兼容、样式定制及构建发布检查。
- [docs/ui-design.md](docs/ui-design.md)：新功能设计原则、桌面支持范围、视觉与交互约束、页面组织。
- [docs/domain-model.md](docs/domain-model.md)：账号、创始人保护、注册、会话、头像与审计规则。
- [docs/api.md](docs/api.md)：协议约定及安装、认证、用户、设置、审计接口。
- [docs/database.md](docs/database.md)：表分组、字段职责、事务、生命周期与迁移边界。
- [docs/schema.sql](docs/schema.sql)：基线版本 1 的 48 张业务表；实际执行嵌入式 Goose 迁移。
- [docs/projects-and-teams.md](docs/projects-and-teams.md)：成员来源、业务角色、资料、生命周期与数据模型。
- [docs/projects-and-teams-detail.md](docs/projects-and-teams-detail.md)：当前 DTO、API、版本控制、选择器、图标及快捷方式。
- [docs/project-repositories.md](docs/project-repositories.md)：多仓库关联、系统首选凭证、远端浏览与同步。
- [docs/project-variants.md](docs/project-variants.md)：Git 分支规则、产品分支、环境、动态仓库范围与批量主干创建。
- [docs/project-releases.md](docs/project-releases.md)：发布阶段、MR 与回退、材料、验收、Tag、归档与文件清理。
- [docs/service-integrations.md](docs/service-integrations.md)：连接、凭证、首选/兜底、Webhook 与适配器边界。
- [docs/service-integrations-api.md](docs/service-integrations-api.md)：类型目录、DTO、条件写入、诊断与入站接收。
- [docs/remote-hosts.md](docs/remote-hosts.md)：SSH 主机、凭证、公钥信任与连接验证。
- [docs/message-management.md](docs/message-management.md)：邮件、短信、钉钉的模块隔离与共同产品要求。
- [docs/email-management.md](docs/email-management.md)：SMTP、发件名称、模板、附件、发送测试与日志。
- [docs/sms-management.md](docs/sms-management.md)：供应商参数映射、模板、本地模拟、发送测试与日志。
- [docs/dingtalk-management.md](docs/dingtalk-management.md)：机器人配置、加签、关键词、文本/Markdown 测试。

## 开发完成验证

开发完成后，除运行与改动相关的测试外，必须使用与 CI 一致的 golangci-lint 版本及仓库 `.golangci.yml` 配置运行 `golangci-lint config verify` 和 `golangci-lint run`，修复全部问题后再交付。若环境限制导致无法完成检查，需明确说明未验证项及原因。

## UI 开发约定

开发新前端功能或重构现有界面时，可先参考 [新功能的设计原则](docs/ui-design.md#新功能的设计原则)，按内容长度、操作频率与风险确定信息展示、表单、操作入口和容器，并据此复核错误恢复、焦点及真实内容下的布局。具体组件约束与桌面验收要求见该文档对应章节。

后续开发不要生搬硬套旧原型、截图或现有页面。先理解用户任务、信息层级、内容长度和设备条件，再选择布局与组件；尺寸、间距和断点按场景调整，遵循 [UI 规范的约束分级](docs/ui-design.md#规范的适用方式)。保持产品语义、权限、数据真实性及可访问性，落实用户最新确认的交互要求。

优先支持 1920×1080 桌面显示环境，以实际浏览器可用视口进行设计与审美验收；更大桌面及系统缩放作为补充复核。手机、小尺寸平板和明显小于目标的窗口不属于当前支持与专项适配范围，不作为发布验收门槛。现有响应式降级可以保留，不为小屏牺牲桌面信息层级与操作效率；键盘、焦点、浅深主题及桌面缩放下的操作可达性仍需保障。具体边界见 [桌面与操作验收](docs/ui-design.md#桌面与操作验收)。

交互原型仅供本地参考，不纳入 Git。纯视觉调整只更新受影响的 UI 规范；业务或接口变化再同步对应契约。现有页面与截图不作为新页面的固定设计模板。

## 前端开发与发布

- React、TypeScript、Vite 与 shadcn/ui 在 `web/` 内维护。正式页面使用根路径，同源 API 使用 `/api/v1`。新增业务路由同步检查登录返回目标和书签兼容。
- 优先使用本地 `components/ui` 和 `components/platform`，按语义变量、变体、组合布局、页面局部布局的顺序定制。公共组件不请求业务 API 或推断权限。
- 在上述桌面支持范围内复核真实计数、字段错误聚焦、未保存保护、pending 防重、键盘和焦点及浅深主题。保留版本冲突与副作用结果未知的处理。
- 每阶段完成检查、部署验证与复核后再提交。提交消息描述具体内容，不使用 P* 阶段编号。开发镜像和正式发布必须依赖同提交的前后端检查。

## Git 提交规范

- Git commit 必须遵循 Conventional Commits：`<type>[optional scope]: <description>`，例如 `fix(delivery): clarify product variant terminology`。
- 提交消息使用英文，包括标题及可选正文、页脚；描述具体改动，不使用阶段编号。
- type 按改动语义选择，如 `feat`、`fix`、`refactor`、`docs`、`test`、`chore`；破坏性变更使用 `!` 或 `BREAKING CHANGE:` 标注。
