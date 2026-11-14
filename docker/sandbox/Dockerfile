# scripts/build-sandbox-images.sh prepares the bounded helper-only build context.
FROM python:3.12-slim-bookworm

LABEL org.antcdp.component="workspace-runtime"

RUN apt-get update \
    && apt-get install -y --no-install-recommends bash ca-certificates curl git ripgrep unzip \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 workspace \
    && useradd --uid 10001 --gid 10001 --home-dir /data/home --shell /bin/bash workspace \
    && install -d -m 0755 /data /usr/local/libexec \
    && install -d -m 0700 /run/antcdp-transfers

COPY --chmod=0555 antcdp-workspace-helper /usr/local/libexec/antcdp-workspace-helper

ENV HOME=/data/home \
    XDG_CONFIG_HOME=/data/home/.config \
    XDG_CACHE_HOME=/tmp/antcdp-cache \
    PIP_CACHE_DIR=/tmp/antcdp-cache/pip

# OpenSandbox starts the control process as root. AntCDP separately supplies
# UID/GID 10001 for every workload command. The installation diagnostic must
# verify that workload processes cannot access or impersonate the control API;
# this image alone does not establish that deployment boundary.
WORKDIR /data
CMD ["tail", "-f", "/dev/null"]
