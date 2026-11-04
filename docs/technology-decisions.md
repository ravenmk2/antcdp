# 技术决策与限制

本文解释当前采用方案，不记录选型过程或备选方案实施计划。实际依赖版本由 go.mod/go.sum 和 web/package-lock.json 锁定。

## 数据访问

采用 `database/sql + go-sql-driver/mysql + sqlx`，保留手写 SQL 与明确事务。sqlx 简化扫描和参数绑定，适合当前动态筛选；代价是字段映射和 SQL 正确性必须通过实库测试验证，没有 SQL 生成期类型检查。

SQL、私有行结构、锁和驱动错误翻译集中在 `internal/store/mysql/`。服务依赖用例仓储与 UnitOfWork 接口，不暴露 sqlx 或 database/sql 句柄；DTO 与数据库行结构分离。参数全部绑定，排序和动态片段只取服务端白名单。其他存储引擎需另行实现方言、事务和迁移，不能只换驱动。

采用 Goose 管理嵌入式 SQL，不使用 ORM 自动同步结构。初始基线直接建立 48 张业务表，后续按版本追加迁移。MySQL DDL 隐式提交，失败恢复与业务事务分开，见 [部署文档](deployment.md)。

## 密码与密钥

用户密码使用 Go bcrypt，cost 固定为 12；库生成随机盐并保存自描述哈希字符串。密码至少 8 个 Unicode 码点、最多 72 个 UTF-8 字节，超长明确拒绝，不截断、不 trim，也不叠加自定义 SHA/HMAC 预哈希。规则由 `internal/platform/password` 实现。

选择 bcrypt 简化哈希格式维护，同时接受其 72 字节上限和不具备内存硬化的限制。哈希调用本身不提供登录限流；并发限制和请求限流由应用负责，部署容量仍需压测。算法和 cost 演进需处理并发改密，不能用旧哈希覆盖新凭据。

HMAC 用于消息认证，不单独作为用户密码哈希。系统主密钥用于可逆加密部署及外部服务秘密，用户密码哈希不依赖主密钥。AAD 与用途派生防止密文跨安装、资源或用途混用。

## 数据库与命名

应用数据库支持 MySQL 8.0.16 及以上的 8.x，CI 覆盖 8.0、8.4；不接受 MariaDB，不因主版本更大而自动宣称兼容。InnoDB、utf8mb4、UTC 毫秒时间是存储基线。

业务表使用单数 snake_case，不设置物理外键/CHECK；主键、唯一索引、字段类型和应用事务共同约束数据。表名不决定 HTTP 集合资源命名。`goose_db_version` 由 Goose 维护，启动校验读取版本，业务命令不修改它。

## 参考入口

- [sqlx 指南](https://jmoiron.github.io/sqlx/)、[MySQL Go 驱动](https://github.com/go-sql-driver/mysql)、[Goose](https://github.com/pressly/goose)：库行为与接口。
- [Go bcrypt](https://pkg.go.dev/golang.org/x/crypto/bcrypt)：哈希调用与输入限制。
- [MySQL 隐式提交](https://dev.mysql.com/doc/refman/8.4/en/implicit-commit.html)：DDL 的事务边界。

以上为参考入口；项目规则与支持范围由本仓库实现及验证决定，不把上游能力等同于本产品已支持能力。
