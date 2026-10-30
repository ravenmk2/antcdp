# 远程主机管理

更新日期：2026-10-30。

## 范围与模型

远程主机是独立控制台入口，系统管理员统一维护 SSH 主机名/IP、端口（默认 22）、名称、不可变 code、说明和启停。仅支持 AntCDP 服务端直连；本轮没有命令执行、交互终端、SFTP、跳板机或 sudo 配置。

每台主机独立维护多份凭证，不跨主机复用。凭证归属为 system/project/personal：系统管理员维护系统凭证；项目管理员及系统管理员维护项目凭证；个人凭证仅本人维护，系统管理员不可代管。不设团队凭证。项目归档后只读；账号删除与个人凭证清理同事务。

实现使用独立业务包 `internal/modules/remotehosts`、HTTP 注册 `internal/server/remote_hosts.go`、MySQL 仓储 `internal/store/mysql/remote_hosts.go` 和前端 `web/src/features/remote-hosts`。不依赖服务集成业务包或页面组件。迁移 7 新增三张表，结构版本为 7；SSH 不注册到 `/service-types`，不出现在 `/service-connections`，不开放 `/admin/service-connections/ssh`。后续执行授权仍由执行模块独立判断。

### 独立存储

- `remote_host`：code、名称、说明、host/port、启停、系统兜底引用、编辑/配置/凭证集合/兜底版本、最近连接诊断及创建信息。code 与名称分别唯一。
- `remote_host_key`：主机、公钥算法、规范化公钥、SHA256 指纹、信任确认人及确认时间。`(host_id,fingerprint_sha256)` 唯一，保留多把公钥支持轮换。公钥增删锁定主机并更新其配置/编辑版本；保留的公钥不重写确认记录。
- `remote_host_credential`：主机、code、归属、名称/说明、username、认证方式、加密秘密及格式/密钥版本、启停、首选、有效期、编辑/材料版本及最近诊断。`code` 唯一；`(host_id,ownership_type,owner_key,name)` 和带 `preferred_slot` 的对应组合分别保证名称及首选唯一。无物理外键/CHECK。

迁移保留旧 SSH 主机/凭证 ID、code、归属、版本、首选/兜底、诊断与密文，提取配置字段及公钥，完成后从服务集成表删除已迁移的 SSH 行，其他服务记录不变。旧版没有保存公钥确认人/时间，迁移行的这两列为 NULL；新确认必填，不推测历史操作者。

新凭证使用独立 `remote-hosts` 派生密钥和资源绑定 AAD，`secret_format_version=2`。迁移的格式 1 只允许按旧 SSH 用途和原派生密钥解密，替换认证后写为格式 2；不自动重加密或更改材料版本。独立 ETag 派生避免主机与服务连接 ID 重合造成版本标识混淆。迁移不提供自动 Down，恢复使用配套数据库/数据目录备份。

## 认证材料与主机信任

支持 `ssh_password`、`ssh_private_key`、`ssh_encrypted_key`。身份为 `identity_config={username}`；秘密分别为 `{token}`（密码）、`{private_key}`、`{private_key,passphrase}`。拒绝不匹配材料、未知方式和非法用户名；私钥最多 32 KiB，密码与口令最多 8192 字节。支持库可解析的 OpenSSH/PEM RSA、Ed25519、ECDSA 私钥，拒绝 SSH 证书、DSA、Agent 和交互式认证。本轮不提供组合认证。

保存前解析私钥并校验口令。方式与完整秘密结构一起加密保存，使用既有独立用途派生和 AES-GCM，AAD 绑定安装、SSH 类型、主机/凭证 ID、认证方式及版本。保存后不提供秘密读取、复制或导出接口。普通资料编辑与认证替换分离；表单关闭和方式切换清除秘密草稿，不存浏览器持久化存储。

主机公钥与登录私钥分开维护。管理员可录入 OpenSSH 公钥，或探测远端公钥并通过可信来源核对 SHA256 指纹后显式加入信任。最多保存 8 把 RSA/Ed25519/ECDSA 公钥，去除注释、拒绝选项、重复与未知算法；支持轮换期间并存公钥。探测结果不自动信任，页面无“忽略校验”。未信任或公钥不匹配时在发送认证材料前阻止认证。主机地址或端口改变时原子清空信任，须重新核对。

配置与公钥共用主机聚合 ETag；探测确认携带探测时的版本，不能把旧地址的探测结果提交到新地址。公钥、地址修改使历史诊断过时。服务端计算指纹，HTTP 内网浏览器也可展示，无需浏览器安全上下文。

## HTTP 契约

基础路径 `/api/v1`，JSON、CSRF、会话、错误与条件请求沿用[API 规则](api.md)。

| 路径 | 方法与职责 |
| --- | --- |
| `/remote-hosts` | GET 登录用户有限目录，仅 ID/code/类型/名称/说明/启停，不含地址、信任或其他归属凭证 |
| `/admin/remote-hosts` | GET、POST 管理员目录与创建 |
| `/admin/remote-hosts/{id}` | GET、PATCH、DELETE 主机聚合 |
| `/admin/remote-hosts/{id}/test` | POST 已保存主机的 SSH 握手及公钥探测/校验 |
| `/admin/remote-hosts/{id}/diagnostics` | GET 最近测试及 outdated |
| `/admin/remote-hosts/{id}/fallback-credential` | GET、PUT、DELETE 系统兜底 |
| `/admin/remote-hosts/{id}/credentials` | 系统凭证集合 |
| `/projects/{project_id}/remote-hosts/{id}/credentials` | 项目凭证集合 |
| `/me/remote-hosts/{id}/credentials` | 本人凭证集合 |

凭证集合的 GET/POST、`/preferred` GET/PUT/DELETE、`/{credential_id}` GET/PATCH/DELETE、`/{credential_id}/authentication` PUT、`/{credential_id}/verify` POST 与 `/{credential_id}/diagnostics` GET，沿用[服务集成凭证契约](service-integrations-api.md)，包括 `If-Match`、删除的 `X-Collection-If-Match`、不可变归属和材料独立版本。

创建 config 为 `{host,port}`，省略 port 使用 22。PATCH config 支持 host、port、host_keys；host_keys 是完整公钥字符串数组，空数组清除，null 非法。GET 主机另返回 `host_key_fingerprints` 映射。新建可不添加凭证、不信任公钥，不自动设首选或兜底。首选与兜底只保存选择意图，本轮不实现执行时的选择链，也不会因认证失败回退。

删除主机要求所有归属凭证清空；停用阻止测试/验证，保留配置和凭证；停用/删除凭证原子清除首选及兜底。自然过期不自动重选。普通登录用户不获得主机管理权限，目录可见不代表未来执行权限。

## SSH 连接与诊断

使用仓库已依赖的 `golang.org/x/crypto/ssh`。遵循受控 DNS/IP 拨号规则：校验解析到的地址并连接经过校验的 IP，支持私网业务地址，拒绝回环、链路本地、元数据等受限目标。整个拨号和 SSH 握手有 10 秒超时及取消关闭，设置独立外连并发与速率限制。

连接测试在取得公钥时结束握手，不发送登录身份认证材料。已信任公钥返回连接检查通过；未信任/不匹配返回受控失败及管理员可核对的公共密钥、指纹。凭证验证仅使用显式指定的已保存材料，认证后立即关闭，不创建 Session 或 SFTP 通道。远端不要求认证时不能声称指定材料验证通过。

诊断分别表达 reachability、host_identity、authentication、permissions；权限始终 unknown。reason 包括 host_key_untrusted、host_key_mismatch、ssh_handshake_failed、authentication_failed、authentication_not_required、timeout 和网络失败。只保存白名单结果，不返回原始远端错误或秘密。结果写回前重新检查归属、权限、状态及主机/凭证版本，改变时丢弃结果。

## UI 交互

控制台 `/admin/remote-hosts/{id?}`、个人设置 `/account/remote-hosts/{id?}`、项目 `/projects/{id}/remote-hosts/{id?}`。页面、凭证面板、配置、公钥、诊断、类型及样式由远程主机模块独立维护；视觉、分页、筛选 URL 与服务集成保持一致，共享基础 UI 组件。主机列表参考用户管理，工具栏、表格、空状态和分页处于同一面板，工具栏不再悬在表格外。SSH 固定协议，创建简化为“主机信息 → 首个凭证”，提供“创建主机和凭证 / 仅创建主机”。创建主机成功而凭证失败时重试仅提交凭证。

详情不显示额外返回按钮、页头说明或停用说明横幅；通过顶部面包屑返回。启用/停用与删除收纳到更多菜单。配置默认只读，编辑原位展开；页签切换保留草稿，离开详情按未保存规则确认。系统凭证与主机公钥各有页签，个人/项目入口仅展示其归属凭证。

## 验证

协议测试覆盖三种认证、错误密码、未信任/公钥不匹配时无认证提交、无认证服务器不误报成功、私钥口令/配置校验。实库 HTTP 测试覆盖独立目录、权限隔离、版本冲突、地址变更清除信任、凭证密文存储、停用与删除限制。最终构建、lint 与部署验证记录见[开发说明](development.md)。
