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

文档入口增删或职责变化时同步索引，完整目录见 [docs/README.md](docs/README.md)。

- [README.md](README.md)：项目简介与 Docker 快速开始。
- [docs/README.md](docs/README.md)：文档目录、产品规则与维护约定。
- [docs/development.md](docs/development.md)：实现进度、验证边界与历史发布记录。
- [docs/initial-delivery.md](docs/initial-delivery.md)：首次迁移与验收的历史记录。
- [docs/ui-design.md](docs/ui-design.md)：UI 产品约束、视觉默认值与设计调整原则。
- [docs/architecture.md](docs/architecture.md)：技术选型、模块边界、前后端结构与视觉基线、实施顺序。
- [docs/technology-decisions.md](docs/technology-decisions.md)：sqlx/sqlc、bcrypt/HMAC 与 MySQL 版本及命名的比较和建议。
- [docs/extensibility.md](docs/extensibility.md)：受控设置 KV、独立凭据表、仓储/事务接口和未来模块的扩展边界。
- [docs/service-integrations.md](docs/service-integrations.md)：服务集成领域与三表设计，包含服务连接、访问凭证、连接内 Webhook 接收设置、首选与兜底、事务及通知模块边界；本次迁移合并为最终版本 5，删除接入点表。
- [docs/service-integrations-api.md](docs/service-integrations-api.md)：服务集成 API、类型目录、连接/凭证/Webhook 设置 DTO、权限、条件请求、诊断与入站接收契约。
- [docs/domain-model.md](docs/domain-model.md)：注册与用户身份、创始人保护、权限、会话、头像及审计规则。
- [docs/api.md](docs/api.md)：HTTP 接口、头像草稿绑定、审计游标查询、授权、并发控制与错误契约。
- [docs/database.md](docs/database.md)：MySQL 表关系、字段职责、索引、事务与生命周期。
- [docs/projects-and-teams.md](docs/projects-and-teams.md)：项目与团队规则、数据库设计与待确认项。
- [docs/projects-and-teams-detail.md](docs/projects-and-teams-detail.md)：项目与团队的权限矩阵、API/DTO、选择器、图标、并发事务、工作区快捷入口与控制台交互、实施及验收详细设计，包含当前实现与目标契约差异。
- [docs/projects-and-teams-schema.sql](docs/projects-and-teams-schema.sql)：九张项目、团队、图标及侧栏偏好表的 DDL 阅读副本，非运行迁移，迁移已通过 MySQL 8.0 验证。
- [docs/schema.sql](docs/schema.sql)：完整 19 张目标业务表的 DDL 阅读副本（一期 7 张、协作 9 张、服务集成新设计 3 张）；实际执行使用嵌入式 goose 迁移，当前合并结构版本 5，验证范围见开发说明，全部业务表不设物理外键/CHECK。
- [docs/deployment.md](docs/deployment.md)：容器目录、配置、主密钥、持久化安装锁、安装恢复、备份与升级设计。

## UI 开发约定

后续开发不要生搬硬套旧原型、截图或现有页面。先理解用户任务、信息层级、内容长度和设备条件，再选择布局与组件；尺寸、间距和断点按场景调整，遵循 [UI 规范的约束分级](docs/ui-design.md#规范的适用方式)。保持产品语义、权限、数据真实性及可访问性，落实用户最新确认的交互要求。

交互原型仅供本地参考，不纳入 Git。纯视觉调整只更新受影响的 UI 规范；业务或接口变化再同步对应契约。历史发布记录不作为新页面的设计模板。
