# 本机开发

工具链以 [go.mod](../../go.mod)、[web/package.json](../../web/package.json)、锁文件及 CI 为准。开发统一使用仓库根目录下的 [dev.mjs](../../scripts/dev.mjs)，优先复用已有服务。

## 启动与调试

```sh
node scripts/dev.mjs start
node scripts/dev.mjs status
node scripts/dev.mjs logs
node scripts/dev.mjs stop
```

开发入口读取 `.data/profile.dev.json`，也可通过 `ANTCDP_DEV_PROFILE` 指定配置。配置格式与校验见 [dev-lib.mjs](../../scripts/dev-lib.mjs)；使用环境已配置的数据库，不擅自安装或启动数据库实例。脚本的首次建库、安装行为应在明确授权的开发环境内使用，遇到已有非空库、配置变化或安装异常时核对处理，不自行重建。

入口管理 Vite 热更新和 Go 源码监听。后端编译失败时旧进程可能仍可访问，必须用 `status` 确认最新源码编译成功及服务就绪，再开始验收。优先读取摘要，失败时通过 `logs` 定位；`stop` 只停止入口管理的进程并保留数据。

开发配置、应用数据、登录凭据、日志和临时产物统一放在被忽略的 `.data/`，不写入文档或 Git。浏览器地址、日志及凭据文件位置以脚本输出为准。

## 构建与验收

前端构建使用 [build-web.mjs](../../scripts/build-web.mjs)，按锁文件安装依赖、检查类型并生成 `web/dist/`；Go 二进制嵌入该产物。生成目录不进入 Git，不手工修改，也不能用旧产物证明新源码已通过。

按[测试规范](testing.md)完成相关检查，再在本机验证真实功能。默认先本机验收、再提交，远程部署按任务需要执行，不以部署成功替代本机验证。正式二进制和维护命令见[部署流程](../operations/deployment.md)。
