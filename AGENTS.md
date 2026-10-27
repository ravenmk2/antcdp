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

文档变化时同步更新

- [README.md](README.md)：项目简介与 Docker 快速开始。
- [docs/README.md](docs/README.md)：一期范围、已确认规则、工程实施约定及默认原型和设计文档入口。
- [docs/development.md](docs/development.md)：开发进度、安装至控制台闭环、头像与审计实现、UI 精简、弹窗修复与页面层级、强制改密与设置保存保护、失败重试与移动导航焦点、表单字段错误与 600ms 搜索、本地启动及验证边界。
- [docs/initial-delivery.md](docs/initial-delivery.md)：首次迁移范围、全新安装、单个初始提交、工程改名与双主题验收。
- [docs/ui-design.md](docs/ui-design.md)：暖色中性双主题视觉基线、蚂蚁头 LOGO 与主题反色、用户菜单外观选择、深色边框与焦点层次、中文排版、组件、导航、响应式、系统用词与交互规范、统一头像、固定操作区用户弹窗与审计工具栏、统一字段错误与搜索交互（600ms）、客户端分页偏好、模块化概览、页面标题精简与刷新动效、受限改密、分类保存、失败重试与移动抽屉交互。
- [docs/architecture.md](docs/architecture.md)：技术选型、模块边界、前后端结构与视觉基线、实施顺序。
- [docs/technology-decisions.md](docs/technology-decisions.md)：sqlx/sqlc、bcrypt/HMAC 与 MySQL 版本及命名的比较和建议。
- [docs/extensibility.md](docs/extensibility.md)：受控设置 KV、独立凭据表、仓储/事务接口和未来模块的扩展边界。
- [docs/domain-model.md](docs/domain-model.md)：注册与用户身份、创始人保护、权限、会话、头像及审计规则。
- [docs/api.md](docs/api.md)：HTTP 接口、头像草稿绑定、审计游标查询、授权、并发控制与错误契约。
- [docs/database.md](docs/database.md)：MySQL 表关系、字段职责、索引、事务与生命周期。
- [docs/projects-and-teams.md](docs/projects-and-teams.md)：下一阶段项目与团队的已确认规则、编码、成员授权、图标及数据库设计草案与待确认项，尚未实现。
- [docs/projects-and-teams-detail.md](docs/projects-and-teams-detail.md)：项目与团队的权限矩阵、API/DTO、选择器、图标、并发事务、工作区快捷入口与控制台交互、实施及验收详细设计，尚未实现。
- [docs/projects-and-teams-schema.sql](docs/projects-and-teams-schema.sql)：九张项目、团队、图标及侧栏偏好表的 DDL 阅读副本，非运行迁移，尚未实库验证。
- [docs/schema.sql](docs/schema.sql)：完整 16 张目标业务表的 DDL 阅读副本（一期 7 张已实现，下一阶段 9 张未实现）；实际执行使用嵌入式 goose 迁移。
- [docs/deployment.md](docs/deployment.md)：容器目录、配置、主密钥、持久化安装锁、安装恢复、备份与升级设计。

交互原型仅供本地参考，不纳入 Git；正式前端开发以 `docs/ui-design.md` 和相关需求文档为基线。
