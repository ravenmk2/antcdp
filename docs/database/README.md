# 数据库约定

所有业务表位于同一 MySQL 数据库。实际安装和升级执行[嵌入式 Goose 迁移](../../internal/store/migrations/mysql)，结构阅读副本按领域放在 [schema 目录](schema/README.md)，不可用于升级现有安装。后端结构变更时同步更新阅读副本，通过开发审核维护，不由 CI 或检查脚本校验。

数据库说明只维护通用约定；字段语义、状态和事务规则归所属领域文档。具体表名、字段和索引直接查结构脚本，不手工维护表数量或重复表清单。

## 存储规则

- 业务表统一使用单数 snake_case：`user`、`user_password`、`session`、`avatar_file`、`system_setting`、`system_instance`、`audit_event`；SQL 中统一用反引号引用表名。REST 集合路径仍为 `/admin/users` 等复数形式，不随表名变化。
- 支持 MySQL 8.0.17 及以上的 8.x；初始结构无 CHECK。DDL 与查询不引入 8.4 独有语法，CI 覆盖 8.0 和 8.4。
- 使用 InnoDB、`utf8mb4_0900_ai_ci`；用户名、枚举、令牌及标识符字段使用 ASCII 二进制比较。用户名只接收规范的小写 ASCII，唯一索引也覆盖已删除账号。
- 业务实体 ID 使用 `BIGINT UNSIGNED`；设置以 name 为主键，安装记录使用单例小整数。API 中 ID 与用户版本使用十进制字符串，避免 JavaScript 数字精度丢失；设置聚合版本为不透明摘要，客户端不解析版本。
- 时间存为 UTC `DATETIME(3)`；应用写入毫秒精度 UTC，连接设置 `time_zone='+00:00'`、`parseTime=true`、`loc=UTC`。时区设置变化不改写已存时间。
- 不使用自动 `ON UPDATE` 时间列；业务服务明确更新 `updated_at`、版本和审计。最近登录时间只更新 `last_login_at`。
- 不用数据库 `ENUM`。状态使用短字符串；所有业务表仅保留主键、唯一键和索引等结构定义，不设置外键或 CHECK。状态、版本、引用存在、字段组合、跨表与权限规则在服务事务中验证；字段类型、NOT NULL 和默认值保留。
- 所有查询参数绑定，不拼接用户输入；排序字段使用服务端白名单。运行连接保持 `multiStatements=false`；goose 使用独立迁移连接，按工具要求开启 `multiStatements=true`，不可复用成请求连接。
- 初始 SQL 不包含 `CREATE DATABASE`、初始用户数据或默认口令。部署者先提供专用空数据库与账号，安装服务创建业务种子。

## 迁移与验证边界

新安装从空数据库执行目标二进制内的完整迁移。版本号相同不代表结构兼容，替换基线文件不会自动修改已安装数据库。结构不匹配时停止业务，不自动改表或清库；需要保留数据时，由维护者备份、核对差异并显式同步结构，验证保留数据及安装身份一致后恢复服务。操作边界见[部署文档](../operations/deployment.md#数据库基线与安装边界)。

Goose 执行嵌入二进制的迁移并维护 goose_db_version；结构变更追加新迁移，不改写已执行文件，也不以 IF NOT EXISTS 掩盖结构不匹配。迁移初始化其所属模块的必需数据，安装服务在独立事务中写入创始人与基础设置；启动核对版本、关键结构和必需设置，不自动改表。

运行连接关闭 multiStatements，迁移使用独立连接并开启该选项。迁移可临时使用环境变量指定的 DDL 账号；应用数据库账号切换 CLI 尚未实现，不将其作为可用维护步骤。MySQL DDL 隐式提交，恢复与配套备份见 [部署文档](../operations/deployment.md)。

实库测试在 MySQL 8.0 和 8.4 覆盖安装、重复迁移、版本与关键字段拒绝及 HTTP 生命周期。故障注入和真实备份恢复的覆盖边界见 [开发指南](../development/testing.md#验证边界)。
