#!/usr/bin/env bash
set -euo pipefail

# Only source code enters this context. This does not configure or start a Server.
# The dedicated image requires Docker workloads on bridge, a host-network Server,
# loopback data ports and an authenticated, separately bound control-plane API.
if [[ $# != 1 || -z "${SERVER_BASE_IMAGE:-}" ]]; then
  echo 'Usage: SERVER_BASE_IMAGE=<official Server 0.2.3 image@sha256:digest> scripts/build-sandbox-server.sh <OpenSandbox checkout>' >&2
  exit 2
fi
if [[ $(uname -s) != Linux ]]; then
  echo 'Build and test this image on the target Linux architecture.' >&2
  exit 2
fi
if [[ ! $SERVER_BASE_IMAGE =~ @sha256:[0-9a-f]{64}$ ]]; then
  echo 'SERVER_BASE_IMAGE must use an immutable sha256 digest for the reviewed official 0.2.3 image.' >&2
  exit 2
fi
repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
source_root=$(cd -- "$1" && pwd)
source_revision=$(tr -d '\r\n' < "$repo_root/docker/sandbox/server-source-revision")
[[ $source_revision =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid Server source revision.' >&2; exit 2; }
git -C "$source_root" cat-file -e "$source_revision^{commit}"
build_root=$(mktemp -d /tmp/antcdp-server-build.XXXXXXXX)
chmod 0700 "$build_root"
cleanup() {
  case "$build_root" in /tmp/antcdp-server-build.????????) ;; *) return 1 ;; esac
  [[ ! -L "$build_root" && $(realpath -- "$build_root") == "$build_root" ]] || return 1
  rm -rf -- "$build_root"
}
trap cleanup EXIT
mkdir "$build_root/source" "$build_root/context"
git -C "$source_root" archive "$source_revision" server LICENSE | tar -x -C "$build_root/source"
patch --batch --forward --fuzz=0 -d "$build_root/source" -p1 < "$repo_root/docker/sandbox/server-control.patch"
cp -R "$build_root/source/server/opensandbox_server" "$build_root/context/opensandbox_server"
cp "$build_root/source/LICENSE" "$build_root/context/LICENSE"
cp "$repo_root/docker/sandbox/Dockerfile.server" "$build_root/context/Dockerfile"
cp "$repo_root/docker/sandbox/server-contract-tests.py" "$build_root/context/server-contract-tests.py"
cp "$repo_root/docker/sandbox/server-source-revision" "$build_root/context/server-source-revision"
cp "$repo_root/docker/sandbox/server-control.patch" "$build_root/context/server-control.patch"
patch_sha256=$(sha256sum "$repo_root/docker/sandbox/server-control.patch" | cut -d ' ' -f 1)
docker build --build-arg "SERVER_BASE_IMAGE=$SERVER_BASE_IMAGE" \
  --build-arg "SERVER_SOURCE_REVISION=$source_revision" \
  --build-arg "SERVER_PATCH_SHA256=$patch_sha256" \
  -t "${ANTCDP_SANDBOX_SERVER_IMAGE:-antcdp-sandbox-server:0.2.3-control-v1}" "$build_root/context"
docker image inspect --format '{{.Id}}' "${ANTCDP_SANDBOX_SERVER_IMAGE:-antcdp-sandbox-server:0.2.3-control-v1}"
