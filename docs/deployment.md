# 安装与容器部署设计

发布原件的持久化目录、流式导出、配套备份和系统管理员手动清理临时文件已实现，详见[发布管理存储设计](project-releases.md#5-存储打包与手动清理)。

构建 React 应用至 `web/dist/` 后编译 Go 二进制。Docker 镜像只需该二进制和运行时证书。正式入口为根路径，构建和路由检查见 [前端设计与发布](frontend.md)。

当前提供配置、安装 API、serve、db migrate、setup recover 和持久化数据目录。账号遗失密码恢复、数据库账号切换 CLI 尚未实现。应用运行在根路径，使用 ANTCDP_ 环境变量、antcdp_session 和 antcdp_csrf Cookie。当前能力及验证边界见 [开发指南](development.md)。

## GHCR 镜像发布与保留

开发镜像由 `.github/workflows/docker-dev.yml` 构建，继续允许 `master`、`main`、`dev`、`develop` 四个分支以及手动运行覆盖同一个 `ghcr.io/ravenmk2/antcdp:dev`。`dev` 始终保留，指向最后一次通过同提交前后端检查并成功推送的构建；多分支之间不按提交时间排序，手动重跑仍按选定的提交构建。构建或推送失败不执行清理。

开发镜像目前只支持 `linux/amd64`，显式设置 `provenance: false` 和 `sbom: false`，不附带构建来源证明与软件物料清单，避免因证明附件产生无标签子镜像。正式发布保留 `.goreleaser.yml` 的版本号、`版本-amd64`、`版本-arm64` 标签及 `latest`；版本标签和架构标签不参与自动清理，`latest` 随正式发布更新。以后启用证明、增加开发镜像架构或迁移 GoReleaser 构建方式时，需要重新检查依赖标签策略。

开发工作流保持整体串行；开发镜像推送及清理、正式发布使用相同的 job 并发组 `ghcr-package-publish`，不取消正在运行的任务，使用 `queue: max` 保留等待中的正式发布（最多 100 个等待任务）。其他向同一个 package 写入的自动化也必须加入该并发组，不能在清理期间另行上传或移动标签。

开发镜像推送成功后，`scripts/check-ghcr-cleanup.mjs` 只读检查 GHCR：分页读取所有有效 package 版本，核对 `dev` 与本次推送摘要一致，读取所有带标签版本的 manifest，并确认索引引用的每个子 manifest 也有独立标签。遇到无标签依赖、未知结构、数据不一致或请求失败时，输出警告并跳过本次清理；镜像发布结果保留。普通镜像的 config/layers 属于 blob，不要求单独打标签。

仅在检查通过后，使用官方 `actions/delete-package-versions@v5`，设置 `delete-only-untagged-versions: true` 和 `min-versions-to-keep: 10`。这会保留全部带标签版本及最新 10 个无标签条目，每次最多删除 100 个较旧的无标签条目；积压较多时通过后续成功发布逐批清理。10 按 GHCR 条目计数，不承诺保留 10 套完整历史构建。需要长期保留或按 digest 固定部署的历史镜像应添加保留标签。

同一 package 的发布任务统一使用上述并发锁，清理只在本次构建和引用检查成功后进行。工作流使用 `GITHUB_TOKEN` 和 `packages: write`，关联仓库还需在 package 的 Manage Actions Access 中具备 Admin 权限；由该仓库工作流发布的 package 通常自动获得此权限。

参考：[官方清理 Action](https://github.com/actions/delete-package-versions)、[GitHub 并发队列](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)、[GitHub package 权限](https://docs.github.com/en/packages/learn-github-packages/deleting-and-restoring-a-package)、[Docker 构建证明](https://docs.docker.com/build/metadata/attestations/)。

## 1. 目录与运行边界

MiSans 字体随前端产物嵌入应用。已存在的 `/fonts/misans/<64 位小写 SHA-256>.woff2` 返回 `Cache-Control: public, max-age=31536000, immutable`，支持浏览器长期复用；字体内容变化会生成新文件名。该目录下固定名称的 CSS、许可等文件返回 `no-cache`，每次使用前需向服务器验证，避免发布后继续使用旧字体清单。缺失字体返回 404，不赋予一年缓存；此策略不提供完整应用离线运行能力。

### 数据库基线与安装边界

当前仅保留 `internal/store/migrations/mysql/00001_initial.sql`，通过 go:embed 编译进二进制。基线版本为 1，直接创建最终的 48 张业务表，不执行历史结构变更或数据搬迁。所有表不设物理外键/CHECK，保留主键、唯一键、索引和字段定义，关联与状态由应用事务保证。

基线只支持从空数据库安装，不提供其他开发结构的原位转换。重建环境必须同时处理数据库和配套安装数据，不能只清空数据库后保留旧配置、主密钥和安装锁，也不能仅改 goose_db_version 伪装结构。

首次安装只接受空数据库，Goose 执行初始迁移后，安装服务另用事务写入创始人和系统设置。普通 serve 只校验版本与关键结构，不自动迁移。后续结构变化从版本 2 起追加迁移，停止服务并备份后运行 `antcdp db migrate`，不得继续改写已发布的初始迁移。

MySQL DDL 隐式提交，单文件迁移不等于原子安装，也不支持盲目重放部分完成的 DDL。setup recover 遇到部分结构会停止并要求维护者检查；不自动清库或降级。回退依赖匹配的数据库与完整数据目录备份。

应用默认工作目录为进程 cwd，数据目录默认 `<cwd>/data/`。启动时解析为绝对路径，后续不受工作目录变化影响。容器使用 `/app/` 为工作目录，故默认数据目录固定为 `/app/data/`。相对 `--data-dir` 按启动 cwd 解析，不按二进制所在目录猜测。

```text
/app/
  antcdp                       # 单个二进制，包含 SPA 和迁移
  data/                         # 唯一应用持久化挂载点
    config.yaml                 # 部署配置；数据库口令为密文
    master.key                  # 32 字节随机主密钥，安装后不得自动重建
    installation.json           # 安装记录，含格式版本、安装 ID、完成时间
    install.lock                # 安装成功后最后写入的持久化锁，内容为安装 ID
    locks/
      instance.lock             # 进程持有的操作系统锁，文件存在不代表锁有效
    .install/
      staging.json              # 中断恢复检查点，只有标识和阶段，不含明文口令
      config.pending.yaml       # 同样只保存加密口令；完成后原子替换正式文件
    media/
      avatars/
        ab/<random>.png         # 由服务端生成的相对路径
    tmp/
      uploads/                  # 同一文件系统中暂存规范化图像
```

二进制、前端和迁移不放到数据挂载里。MySQL 数据由数据库服务自己管理，不能在应用数据卷中夹放 `/data/mysql`。应用日志写 stdout/stderr，不默认在数据目录创建日志文件。

Unix 下配置、主密钥、安装记录、安装锁及恢复文件权限为 0600，目录为 0700；容器数据目录归运行用户所有。Windows 对当前部署账号及 SYSTEM 设置受限 ACL，关闭继承，不能把 Unix mode 当作已经限制 Windows 访问。仓库已忽略 `/data/`，避免开发数据及密钥入库。

当前版本一个应用实例持有 `instance.lock`。同一数据目录的第二个进程拒绝启动；不同本地卷也不能作为同一系统的多副本部署方式。维护命令要求先停止服务，再独占数据目录。

`data/install.lock` 与 `data/locks/instance.lock` 职责不同：前者持久记录安装已经完成，存在即跳过安装向导；后者只防止多个进程同时操作同一数据目录。安装锁存在而配置或数据库异常时进入维护状态，不重新开放安装。安装锁纳入备份，不因重启或更换容器删除。

## 2. 配置职责

配置优先级为显式 CLI 参数 > 环境变量 > `data/config.yaml` > 默认值。只对实际声明的配置键应用这一规则；安装 ID、主密钥来源及安装完成状态不能靠任意环境变量绕过校验。运行时不打印配置对象或包含口令的 DSN。

| 配置 | 位置 / 建议环境变量 | 说明 |
| --- | --- | --- |
| 数据目录 | CLI `--data-dir` / `ANTCDP_DATA_DIR` | 默认 cwd 下 data；在读取配置文件之前确定 |
| 监听地址 | `server.listen` / `ANTCDP_LISTEN` | 默认 `0.0.0.0:8080` |
| 公开地址 | `server.public_url` / `ANTCDP_PUBLIC_URL` | 必须为无用户信息、查询和片段的绝对 HTTP(S) 来源地址；当前版本部署在根路径 |
| 可信反代 | `server.trusted_proxies` / `ANTCDP_TRUSTED_PROXIES` | 默认空数组；环境变量采用逗号分隔 CIDR |
| Cookie 安全属性 | 从公开地址派生 | HTTPS 必须 Secure；HTTP 仅用于本地预览或维护者明确选择的内网部署 |
| 数据库连接 | `database.*` | 安装向导保存；密码为主密钥加密值 |
| 数据库私有 CA | `database.ca_file` / `ANTCDP_DATABASE_CA_FILE` | 可选部署文件路径；用于 verify_identity，不由浏览器指定路径 |

未安装时公开地址可以由环境变量预置，未配置则仅以 `http://localhost:8080` 作为本地引导默认值；浏览器使用其他地址访问时必须配置对应来源地址。安装向导只读展示该地址，来源与 CSRF 校验以它为准，不从任意 Host / Forwarded 请求头自动推导可信地址。

配置示例，不含可使用的口令或主密钥：

```yaml
schema_version: 1
installation_id: "<32 位小写十六进制安装 ID>"
server:
  listen: "0.0.0.0:8080"
  public_url: "https://antcdp.example.com"
  trusted_proxies: []
database:
  host: "mysql"
  port: 3306
  name: "antcdp"
  username: "antcdp"
  password: "enc:v1:<base64url nonce 与密文>"
  tls_mode: "disabled"
  ca_file: ""
```

业务设置（系统名称、时区、注册开关、会话有效期）只在 MySQL `system_setting` 受控 KV，不与 YAML 同时维护。安装创建注册表要求的全部键；后续新增键由迁移补齐，启动检查必需键的类型和范围，缺失或无效时进入维护状态，不静默替换成默认值。账号没有邮箱配置；SMTP 配置在独立邮件模块的表中，不写入这四项系统设置或部署 YAML。系统设置界面仅展示部署公开地址，不修改它。

主密钥使用 AES-256-GCM 保护敏感配置；密文包含格式版本和随机 nonce，AAD 绑定安装 ID 与字段用途。启动先读取密钥、校验本地记录，再解密数据库口令。丢失主密钥时不能生成一把新密钥后继续尝试旧密文。

## 3. 启动状态

| 状态 | 条件 | 行为 |
| --- | --- | --- |
| `setup_required` | 配置不存在或仅含空白；没有安装锁、安装记录、密钥、中断检查点或其他业务文件；空目录及进程锁可以存在 | 展示安装欢迎页及数据库连接步骤；目标 schema 为空才能继续和安装 |
| `initializing` | 本进程正在持有安装锁执行安装 | 禁止第二次安装，显示初始化中 |
| `ready` | 配置、密钥、安装记录、持久化安装锁、数据库安装 ID/密钥指纹与迁移版本全部匹配 | 跳过安装，开放业务 API |
| `recovery_required` | 缺少部分本地文件、有安装中断痕迹、ID/密钥指纹冲突或数据库出现无法解释的部分结构 | 停止业务，提示部署维护者本地检查，不能从页面重新安装 |
| `unavailable` | 已有配置但数据库不可达、服务暂不可用或迁移版本不兼容 | 停止业务，保留原安装状态，不出现新安装向导 |

存在旧配置但数据库为空也不能视为全新部署；这是需要恢复或显式处理的状态。数据库连通但迁移版本不兼容时提供通用维护提示，详细版本诊断只给维护者日志或命令。

兼容没有 `install.lock` 的已完成安装时，先完整校验配置、安装记录、主密钥及数据库身份和迁移版本，再补写一次安装锁。缺少锁文件本身不意味着允许重装；已有锁与安装 ID 不符时停止自动处理。

`GET /healthz` 保持存活检查，进程能够处理 HTTP 时为 200；不承诺数据库可用。新增 `GET /readyz` 在 `ready` 或 `setup_required` 返回 200，允许安装界面被访问，其余状态为 503。检查内容不返回密钥、路径或连接细节。探针的这个定义意味着“可以接受当前阶段的 HTTP 流量”，部署监控另从 setup 状态区分是否已安装。

## 4. 安装条件与数据库要求

安装不使用安装令牌或安装会话。仅配置缺失或为空且没有已有安装痕迹时开放向导；数据库连接参数由第一步输入，因此目标库是否为空在连接检查时确认，最终安装取得锁后再次确认。安装写请求仍需同源、CSRF、限流和状态校验；每次操作重新核验本地条件。页面及日志不展示数据库已有账号或密钥信息。

安装前部署者准备 MySQL 8+ 的专用空 schema 和具有初始化权限的账号；当前支持 MySQL 8.0.16 及以上的 8.x 版本，不限于 8.4。后续主版本需通过迁移兼容验证，不能只比较版本号大小。应用不用 MySQL root，不在不明的现有 schema 上直接套表。连接检查验证版本、schema 是否为空及 utf8mb4 字符集，不建库、不写业务数据；安装取得锁后再次检查。完整 DDL/写入权限在实际安装步骤验证，连接检查通过不保证权限齐备。

安装临界区同时使用数据目录操作系统锁和 MySQL `GET_LOCK` 命名锁。数据库锁名使用目标 schema 的固定摘要，长度不超过 64 字节；专用连接持有至安装结束并显式释放。它不是 SQL 事务锁，不能假定事务提交会释放它。多个实例指向同一空 schema 时，后取得锁的一方重新检查安装记录与 schema，不能继续覆盖。

## 5. 安装步骤与恢复

这些步骤有先后顺序，不能声称跨文件系统与 MySQL 整体原子提交：

1. 验证本地未安装条件、同源、CSRF、输入及数据库目标；取得数据目录进程锁与数据库命名锁，再检查配置仍为空且数据库仍为空。
2. 生成安装 ID 和唯一主密钥。将密钥、含加密数据库口令的 pending 配置和检查点写入同一数据目录，使用临时文件、fsync 与原子重命名；恢复后必须复用这一把密钥。
3. 执行对应版本的 goose 初始迁移。MySQL DDL 隐式提交，此阶段不与创建账号放进同一个事务。
4. 一个业务事务内创建创始人、凭据、默认设置、`system_instance` 和安装完成审计。安装 ID 与主密钥指纹必须匹配已落盘内容。
5. 业务事务提交成功后，用关闭多语句功能的独立运行连接重新核验迁移、安装 ID 和密钥指纹；原子就位正式配置和 `installation.json` 安装记录，最后独占创建 `install.lock` 并 fsync，成功后进入 ready。
6. 清理已完成的检查点，将临时 CSRF 密钥切换为主密钥派生值。即使检查点清理失败，ready 状态也必须拒绝所有安装写操作。

主密钥和暂存配置必须先于种子事务提交得到持久性保证；安装记录和安装锁必须晚于提交。容器被终止后，锁文件缺失不等于数据库未初始化。安装成功的最终请求另外创建创始人会话，仅响应给该浏览器。首次成功显示 5 秒倒计时及立即进入首页按钮；会话创建失败不回滚已完成安装，进入正常登录。浏览器若未收到最终响应，先读 `/setup/status`；已 ready 则不能重复创建创始人或凭状态补发会话，由正常访问守卫进入首页或登录。已有安装重访 `/setup` 也使用相同守卫直接跳转。

恢复命令的目标是核对已有检查点并完成可证明安全的步骤：

| 中断位置 | 处理原则 |
| --- | --- |
| 本地暂存完成，数据库未迁移 | 验证同一安装 ID、密钥及空 schema 后继续 |
| 部分 DDL 已提交 | 当前恢复命令停止自动执行；由维护者核对迁移版本与实际结构，不盲目重放整个 SQL 文件 |
| 迁移完成，种子未提交 | 验证本次安装拥有的结构，再原子创建种子 |
| 种子已提交，本地配置、记录或安装锁未完成 | 数据库安装 ID 与主密钥指纹均匹配时，完成 pending 配置、记录与安装锁，不重建用户或密钥 |
| 记录不匹配、结构无法解释 | 停止自动恢复，提供脱敏诊断；由维护者修复或明确改用新的空 schema |

不提供自动 DROP、清空数据目录、覆盖陌生 schema、重新生成主密钥的恢复捷径。检查点只是证据之一，不能仅因文件写着某个阶段就跳过数据库校验。

## 6. CLI

已实现的命令：

```text
antcdp serve --data-dir /app/data
antcdp db migrate --data-dir /app/data
antcdp setup recover --data-dir /app/data
```

未实现的维护能力：遗失密码恢复与数据库账号切换。不要调用文档外推测出的 admin reset-password 或 config set-database 子命令。

无子命令可作为 serve 的兼容入口。维护命令须先停止服务，独占数据目录；setup recover 需要创始人密码时通过交互式隐藏输入读取，不放在命令行参数或普通日志中；它用于完成中断安装，不是已安装账号的密码找回。

迁移可选用维护者提供的专用 DDL 账号，目前通过临时 `ANTCDP_MIGRATION_USERNAME`、`ANTCDP_MIGRATION_PASSWORD` 提供，不覆盖正式运行配置。恢复需要重新创建创始人凭据时，由交互终端隐藏输入并确认；已有种子则不要求新密码。

## 7. 容器

Dockerfile 已采用以下目录与用户。二进制先在构建流水线编译，运行镜像不包含 Node、Go 工具链或源码。Linux 容器已验证非 root、只读根、私有数据目录及安装后重启；完整物理备份恢复及生产环境负载需专项验收。

```dockerfile
FROM alpine:3.24.2
RUN apk add --no-cache ca-certificates \
    && addgroup -g 10001 antcdp \
    && adduser -D -u 10001 -G antcdp antcdp \
    && mkdir -p /app/data \
    && chmod 700 /app/data \
    && chown -R antcdp:antcdp /app
WORKDIR /app
COPY --chmod=0555 --chown=antcdp:antcdp antcdp /app/antcdp
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["/app/antcdp"]
CMD ["serve"]
```

基础镜像已锁定版本，正式交付再锁定摘要。二进制已嵌入 Go 时区数据。容器使用 Docker 命名卷保存 `/app/data`，不绑定宿主机目录；卷内目录归 UID/GID 10001 所有，目录模式 0700。镜像与数据卷分别管理，删除或替换应用容器不能隐式清空数据。

只读根文件系统仍允许写入 `/app/data`。数据库持久化与应用数据卷相互独立。实际部署操作及临时文件约束不属于本文的产品设计范围。

## 8. 备份、升级与恢复验收

备份单位为 MySQL 与完整应用数据目录，尤其包含 master.key、加密配置、安装记录、install.lock、头像、图标及发布文件。建议停服后取得对应时间点备份，保留原始文件权限；仅备份数据库不能恢复密钥及文件内容。恢复后核对安装 ID 和主密钥指纹，不能混用另一系统的数据目录。

升级流程：停服 → 备份数据库与数据目录 → 用目标版本二进制显式执行迁移 → 启动并验证 → 恢复流量。不在普通启动时静默升级，不自动降级数据库。失败时按备份整体恢复，不只替换旧二进制。

实施验收至少覆盖：全新安装、并发安装、每个持久化步骤强制中断后恢复、数据库断连、密钥/标记缺失、安装 ID 不匹配、非 root/只读根容器、头像持久化、备份恢复和显式升级。检查方法与覆盖边界见 [开发指南](development.md)。

安装锁和 DDL 行为参考 MySQL 官方文档：[命名锁](https://dev.mysql.com/doc/refman/8.4/en/locking-functions.html)、[隐式提交](https://dev.mysql.com/doc/refman/8.4/en/implicit-commit.html)。容器例子的环境变量含义参考 [MySQL 官方容器文档](https://dev.mysql.com/doc/refman/8.4/en/docker-mysql-more-topics.html)。
