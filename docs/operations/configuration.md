# 运行配置

## 配置职责

配置优先级为显式 CLI 参数 > 环境变量 > `data/config.yaml` > 默认值。只对实际声明的配置键应用这一规则；安装 ID、主密钥来源及安装完成状态不能靠任意环境变量绕过校验。运行时不打印配置对象或包含口令的 DSN。

| 配置 | 位置 / 建议环境变量 | 说明 |
| --- | --- | --- |
| 数据目录 | CLI `--data-dir` / `ANTCDP_DATA_DIR` | 默认 cwd 下 data；在读取配置文件之前确定 |
| 监听地址 | `server.listen` / `ANTCDP_LISTEN` | 默认 `0.0.0.0:8080` |
| 公开地址 | `server.public_url` / `ANTCDP_PUBLIC_URL` | 必须为无用户信息、查询和片段的绝对 HTTP(S) 来源地址；部署在根路径 |
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

业务设置由所属模块持久化，不与部署 YAML 重复维护。键、默认值和校验由注册代码定义；缺少必需配置时进入维护状态。部署公开地址不由业务接口修改。

主密钥使用 AES-256-GCM 保护敏感配置；密文包含格式版本和随机 nonce，AAD 绑定安装 ID 与字段用途。启动先读取密钥、校验本地记录，再解密数据库口令。丢失主密钥时不能生成一把新密钥后继续尝试旧密文。
