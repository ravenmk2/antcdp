# AntCDP

[![Test](https://github.com/ravenmk2/antcdp/actions/workflows/test.yml/badge.svg)](https://github.com/ravenmk2/antcdp/actions/workflows/test.yml) [![Release](https://img.shields.io/github/v/release/ravenmk2/antcdp)](https://github.com/ravenmk2/antcdp/releases) [![License](https://img.shields.io/github/license/ravenmk2/antcdp)](LICENSE)

AI Native Team Collaboration & Development Platform

## Quick Start

Prepare an empty MySQL 8.x database (8.0.17 or later) and a database user. Create `config.toml` in your working directory:

```toml
[server]
listen = "0.0.0.0:8080"
public_url = "http://localhost:8080"

[database]
host = "mysql.example.internal"
port = 3306
name = "antcdp"
username = "antcdp"
password = "your-database-password"
tls_mode = "disabled"
```

Replace the database settings with your actual connection details. The database host must be reachable from inside the container. For TLS, optional sandbox, and custom installation password settings, see [config.example.toml](conf/config.example.toml).

Start AntCDP with the configuration mounted read-only and a persistent data volume:

```sh
docker run -d \
  --name antcdp \
  --restart unless-stopped \
  -p 8080:8080 \
  -v "$PWD/config.toml:/app/conf/config.toml:ro" \
  -v antcdp-data:/app/data \
  ghcr.io/ravenmk2/antcdp:dev
```

After the container starts, read the initial installation password:

```sh
docker exec antcdp cat /app/data/install-password
```

Open [http://localhost:8080](http://localhost:8080) and use this password to complete the installation wizard and create the founder account. The password file is removed after installation.

For remote access, set `public_url` to your server's public HTTP(S) origin before starting AntCDP. Application data is persisted in the `antcdp-data` volume.
