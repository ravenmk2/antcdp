# AntCDP

[![Test](https://github.com/ravenmk2/antcdp/actions/workflows/test.yml/badge.svg)](https://github.com/ravenmk2/antcdp/actions/workflows/test.yml) [![Release](https://img.shields.io/github/v/release/ravenmk2/antcdp)](https://github.com/ravenmk2/antcdp/releases) [![License](https://img.shields.io/github/license/ravenmk2/antcdp)](LICENSE)

AI Native Team Collaboration & Development Platform

AI 原生团队协作开发平台。当前提供安装、账号与权限、用户管理、系统设置、头像和审计等基础能力，支持浅色、深色及跟随系统的暖色界面。项目、工作流和 AI 执行等业务能力仍在后续规划中。迁移与首次交付范围见 [首次交付说明](docs/initial-delivery.md)，开发与验证状态见 [开发说明](docs/development.md)。

## Quick Start

Prepare an empty MySQL 8.x database (8.0.16 or later) and a database user, then run:

```sh
docker run -d \
  --name antcdp \
  --restart unless-stopped \
  -p 8080:8080 \
  -e ANTCDP_PUBLIC_URL=http://localhost:8080 \
  -v antcdp-data:/app/data \
  ghcr.io/ravenmk2/antcdp:dev
```

Open [http://localhost:8080](http://localhost:8080) and complete the installation wizard.

For remote access, replace `localhost` in `ANTCDP_PUBLIC_URL` with your server IP or domain. Application data is persisted in the `antcdp-data` volume.
