# AntCDP

[![Test](https://github.com/ravenmk2/antcdp/actions/workflows/test.yml/badge.svg)](https://github.com/ravenmk2/antcdp/actions/workflows/test.yml) [![Release](https://img.shields.io/github/v/release/ravenmk2/antcdp)](https://github.com/ravenmk2/antcdp/releases) [![License](https://img.shields.io/github/license/ravenmk2/antcdp)](LICENSE)

AI Native Team Collaboration & Development Platform

[开发文档](docs/README.md)

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
