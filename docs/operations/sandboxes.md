# 沙箱环境部署

本文说明 AntCDP Docker 沙箱的通用运行要求。安装向导仅连接和验证已部署服务，可以跳过；不安装 Docker、OpenSandbox Server 或 Kubernetes。平台应用继续使用原来的单个 MySQL 数据库和应用数据目录。

## 运行组件

需要 OpenSandbox Server 的 Docker runtime、bridge 网络及支持 DNS 和 IP 策略的 egress 组件，以及两类镜像：执行控制镜像和工作空间镜像。Server 的 runtime 在部署时选择，创建请求不能切换 Docker/Kubernetes。不接入 Kubernetes，不开放 host bind、subPath 或 host 网络作为工作空间配置。

工作空间镜像包含 Python、Git、curl、ripgrep、bash、证书、ZIP 工具和可信文件辅助程序。镜像中 UID/GID 10001 是工作负载用户，`/data` 由 root 管理顶层目录，个人可写内容位于受管子目录。操作系统工具、辅助程序和父目录不可由工作负载改写。模型和检索 API Key 留在平台后端，不注入沙箱。

## 构建受控镜像

在 Linux、与运行 Docker 相同的 CPU 架构上，准备 Go、Git、patch、Docker 和 OpenSandbox 源码 checkout。从 AntCDP 仓库执行：

```sh
EXECD_BASE_IMAGE='<official-execd-release-1.1.1-image>' \
  bash scripts/build-sandbox-images.sh /path/to/OpenSandbox
```

占位符必须替换为对应架构的官方 execd `release-1.1.1` 基础镜像。脚本从 `docker/sandbox/execd-source-revision` 固定的提交导出源码，不使用 checkout 中未提交的内容；应用 `execd-control.patch`、执行限定测试、构建二进制。补丁及保留的上游许可证随构建材料维护，不修改输入源码。脚本使用临时目录并在退出时清理，不把源码、凭据或配置放入工作空间镜像。

默认镜像引用为 `antcdp-execd:latest` 和 `antcdp-sandbox:latest`；可通过 `ANTCDP_EXECD_IMAGE`、`ANTCDP_SANDBOX_IMAGE` 指定固定构建引用。输出包含实际镜像 ID。环境模板中的工作空间镜像必须使用明确版本或不可变内容引用，不接受 `latest`。单机 Docker 可使用构建产生的 `sha256:` 镜像 ID；分发到其他 daemon 时应使用已推送仓库的 digest。执行控制镜像由 Server 的 `runtime.execd_image` 配置；更新它后应重启该 Server，使缓存的执行文件更新生效。

该兼容补丁解决两项准入要求：启用控制令牌时初始化接口也必须认证；普通命令的最终环境必须移除控制凭据，包含请求环境覆盖的注入路径。平台为每个实例按安装密钥和登记归属派生不同控制令牌，API Key 轮换不会改变已有实例令牌。仅配置 Server API Key 或仅切换命令 UID 都不能替代这些措施。后续升级 execd 时必须重新核验相同行为，不能只按版本字符串认定兼容。

### 专用 Docker 代理控制服务

需要在同一 Docker daemon 上与其他控制服务并存时，可构建本项目提供的专用 Server 镜像：

```sh
SERVER_BASE_IMAGE='<official-server-0.2.3-repository>@sha256:<digest>' \
  ANTCDP_SANDBOX_SERVER_IMAGE='antcdp-sandbox-server:latest' \
  bash scripts/build-sandbox-server.sh /path/to/OpenSandbox
```

脚本从 `server-source-revision` 指定的提交导出源码，以零模糊匹配应用 `server-control.patch`；基础镜像必须使用官方 0.2.3 的不可变 digest。构建验证实际包版本和导入路径，并运行不依赖 Docker socket 的契约测试。镜像保留上游许可证、修改说明、源码版本与补丁。构建本身不会创建沙箱或启动服务。

这是只支持 Docker 代理访问的专用封装：工作负载仅允许 bridge，`docker.publish_host` 仅接受 IPv4 loopback，默认 `127.0.0.1`；包括执行、工作负载、egress 和额外端口的全部发布地址均受此约束。Server 自身需要使用宿主网络，使其能访问这些 loopback 端口；`server.host` 应显式绑定平台可达的管理地址，配置独立 API Key。`docker.host_ip` 设为同一个 loopback 目标；平台连接选择 `server_proxy`，不能在此拓扑下回退为直连。管理地址可达性和防火墙仍属于部署约束，私有地址本身不构成完整隔离证明。

内部 Docker 标签使用 `io.antcdp.sandbox/`，避免与上游默认标签的控制服务互相恢复或清理资源。创建和修改元数据同时拒绝注入两种系统前缀，响应也不会暴露内部标签；外部 API、平台归属元数据和执行认证协议保持不变。同一 daemon 的同一内部标签命名空间只由一个控制服务管理，不能再启动另一套使用相同前缀的独立控制器。多个可信平台可以连接同一 Server；Docker socket 管理者仍处于共同信任边界，此机制不提供 Kubernetes 式租户隔离。

Server 配置和状态使用独立持久卷，配置文件只读挂载并限制权限。Docker 元数据实际位于运行用户的 `$HOME/.opensandbox/metadata`，只持久化 SQLite 路径不足以保存它。需保存完整 `$HOME/.opensandbox`，配置持久重启策略，固定已验证的执行控制镜像引用。工作空间卷与 Server 状态卷分别管理；删除控制服务容器不能连带删除用户文件。

## 连接、卷和网络

控制台只配置一份 Server endpoint、API Key、access_mode 和超时。个人环境使用平台统一模板，服务型环境各自配置镜像、CPU、内存和网络。直连要求后端可到达数据面端口；代理模式要求服务正确转发执行和文件控制令牌。浏览器不接收原始端点和密钥。

每台云电脑独占 Docker named volume，卷名 `acdp-<安装标识前8位>-<32位小写十六进制卷ID>`。首次创建允许建卷，普通重建必须重挂原卷且禁止创建缺失替代卷。所有实例长期保留，暂停不删除；后端返回的永久生命周期须被实际核实。

更换地址须经过目标只读检查和二次确认，等待在途活动收尾，保留逻辑电脑与会话绑定，后续创建新实例和新空卷。旧文件不迁移，不记录旧资源清单或自动清理队列，管理员承担旧环境处理责任。清空连接只允许无运行资源时执行。

当前适配器没有独立卷删除能力时拒绝永久删除已有卷的电脑，不能把删除容器视作卷清理。运维清理需自行核对明确目标及活动状态；平台不假报完成。备份分别覆盖数据库、平台私有文件、安装密钥和云电脑卷。

出站规则采用默认策略、地址预设、允许列表和阻止列表。部署强制阻止优先，其次自定义阻止；自定义允许可作为普通地址预设的例外。域名控制不等于 URL 路径过滤，放行内网名称还需放行对应 IP/网段。平台和数据库地址、Server endpoint 的名称及创建时解析地址加入强制保护；DNS 后续变化和管理面的其他入口仍需部署防火墙保护。不要向工作负载挂载 Docker socket、宿主管理接口或平台数据目录。

网络配置只影响新建或重建实例。需要立即收紧时管理员先停止相关运行再重建，不热更新。一次完整命令诊断不能证明所有网络规则已执行；能力结果可明确显示网络仍待独立核验，不把配置保存视作网络测试通过。

## 验证与验收

连接预览只检查控制面健康。执行、文件和持久性使用明确授权的测试资源验证，测试结束清理本次资源；不读取个人会话或个人文件。创建结果未知时保留原标记并核实，不能重新创建另一台掩盖结果。

真实适配器测试为 `internal/sandboxadapters/opensandbox` 中的 opt-in integration tests。端点、密钥、运行镜像及测试探测地址仅由环境变量输入，缺失环境的跳过不算通过。至少核验直连与代理、工作负载无法访问控制接口或控制环境、辅助程序不可替换、文件快照完整、后台取消后确认退出、原卷重挂载，以及默认内网阻止、自定义允许例外和阻止优先。

专用代理控制服务另需核验实际 Docker 端口绑定全部为 loopback、平台经代理可用而不能从外部直连数据端口、无控制凭据拒绝访问、重启后仅恢复自身标签资源，以及持久元数据仍可读取。离线契约测试不能代替这些真实拓扑检查。通用适配器的直连测试适用于另行配置且满足同等认证要求的环境，不适用于上述仅代理拓扑。

应用重启后旧运行会结算为中断，物理操作继续只读核实；未确认的命令和文件传输保持资源引用。管理员回收未知实例也必须先实际终止并核实，不能通过强制清锁继续写同一工作空间。
