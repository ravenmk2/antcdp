# 本地开发

AntCDP 使用 Go、MySQL 与本地持久化目录，同源提供 React SPA 和 API。架构边界见[架构](../architecture/overview.md)，检查方法见[测试与验证](testing.md#检查命令)。

## 本地启动

使用 `go.mod` 指定的 Go 工具链、Node.js 和 npm；CI 使用 Node.js 24，允许的 Node 版本范围以 `web/package.json` 的 engines 为准。以下命令在仓库根目录执行，适用于 PowerShell 与常见 Unix shell：

```sh
node scripts/dev.mjs start
node scripts/dev.mjs status
node scripts/dev.mjs logs
node scripts/dev.mjs stop
```

开发入口默认读取项目根目录下的 `.data/profile.dev.json`，也可通过 `ANTCDP_DEV_PROFILE` 指定配置文件。数据库字段集中在 `database` 对象中：`host`、整数 `port`、`name`、`username` 和 `password`，可选 `mysql_client` 指定 MySQL 客户端路径。实际配置值由开发环境提供，不提交到 Git。

`start` 检查依赖与端口，复用已有开发服务，或启动 Vite 和 Go 源码监听。首次启动会使用配置指定的开发数据库完成建库和应用安装；账号需具有相应权限。已有非空数据库、配置变化或安装异常时停止，不自动重建。

浏览器入口为 `http://127.0.0.1:5173`。Vite 代理本机 API，前端修改热更新；后端编译成功后重启，失败时保留旧进程。通过 `status` 确认最新代码和应用状态，`logs` 查看近期日志。`stop` 仅停止本入口管理的进程并保留数据。

`.data/app/` 保存应用数据，`.data/runtime/` 保存进程、构建和检查记录，`.data/logs/` 保存日志，`.data/tmp/` 保存临时文件。首次生成的开发登录凭据位于 `.data/runtime/login.json`。

开发入口不会安装或启动 MySQL 服务。使用 MySQL 8.0.17 及以上的 8.x 数据库及 utf8mb4 字符集，不要导入 `docs/database/schema/`。应用本身仍不负责创建数据库或账号，自动建库由开发脚本完成。

## 补充启动方式

需要手动启动应用或验证正式前端构建时，先停止统一入口管理的服务，再运行：

```sh
node scripts/build-web.mjs
go run ./cmd/antcdp serve --listen 127.0.0.1:8080 --public-url http://localhost:8080 --data-dir .data/app
```

打开 `http://localhost:8080`。已有安装复用应用配置；首次手动安装需预先准备专用空库和账号。应用默认数据目录仍为 `<cwd>/data/`，本机开发显式使用 `.data/app/`。公开来源必须与浏览器实际访问地址一致；安装成功最后写入 `install.lock`，配置、密钥或数据库异常不会重新开放安装。状态和维护命令见[部署文档](../operations/deployment.md)。

需要在两个终端分别观察前后端输出时，可运行：

```sh
node scripts/dev-backend.mjs --listen 127.0.0.1:8080 --public-url http://127.0.0.1:5173 --data-dir .data/app
node scripts/dev-web.mjs
```

后端脚本监视 Go 与 SQL 源码，传入参数会替换默认 serve 参数。Vite 将 API 与健康检查代理给 Go，后端地址可用 `ANTCDP_DEV_BACKEND` 调整。这些前台进程由各自终端管理，不与统一入口同时启动，也不执行其自动建库和安装步骤。组件与路由规则见[前端文档](frontend.md)。

## 前端构建产物

构建脚本按锁文件安装依赖、执行 TypeScript strict 校验并生成 `web/dist/`。字体资源随构建准备并保留来源与许可。编译器及工具链职责见 [前端文档](frontend.md)。生成产物随 SPA 嵌入 Go 二进制；`web/dist` 不进入 Git，也不手工修改。
