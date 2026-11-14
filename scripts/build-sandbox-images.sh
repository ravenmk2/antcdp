#!/usr/bin/env bash
set -euo pipefail

# Run on the target Linux architecture with Go, Git, patch and Docker available.
# Only local sources are read; no credentials or service configuration enter
# either image context. The source revision must match the reviewed patch.
if [[ $# != 1 || -z "${EXECD_BASE_IMAGE:-}" ]]; then
  echo 'Usage: EXECD_BASE_IMAGE=<official execd release-1.1.1 image> scripts/build-sandbox-images.sh <OpenSandbox checkout>' >&2
  exit 2
fi
if [[ $(uname -s) != Linux || $(go env GOOS) != linux ]]; then
  echo 'Build and test the sandbox images on the target Linux architecture.' >&2
  exit 2
fi
repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
source_root=$(cd -- "$1" && pwd)
source_revision=$(tr -d '\r\n' < "$repo_root/docker/sandbox/execd-source-revision")
git -C "$source_root" cat-file -e "$source_revision^{commit}"
build_root=$(mktemp -d /tmp/antcdp-sandbox-build.XXXXXXXX)
chmod 0700 "$build_root"
cleanup() {
  case "$build_root" in /tmp/antcdp-sandbox-build.????????) ;; *) return 1 ;; esac
  [[ ! -L "$build_root" && $(realpath -- "$build_root") == "$build_root" ]] || return 1
  rm -rf -- "$build_root"
}
trap cleanup EXIT
mkdir "$build_root/source" "$build_root/control" "$build_root/runtime"
git -C "$source_root" archive "$source_revision" components/execd components/internal LICENSE | tar -x -C "$build_root/source"
patch --batch --forward -d "$build_root/source" -p1 < "$repo_root/docker/sandbox/execd-control.patch"
(
  cd "$build_root/source/components/execd"
  runtime_tests=$(go test ./pkg/runtime -list '^TestPrepareCommandStripsControlCredentials$')
  if ! grep -Fxq 'TestPrepareCommandStripsControlCredentials' <<< "$runtime_tests"; then
    echo 'The required control-credential environment test is missing.' >&2
    exit 1
  fi
  go test ./pkg/web -run '^TestAccessToken' -count=1
  go test ./pkg/runtime -run '^TestPrepareCommandStripsControlCredentials$' -count=1
  CGO_ENABLED=0 go build -trimpath -buildvcs=false -o "$build_root/control/execd" .
)
cp "$build_root/source/LICENSE" "$build_root/control/EXECD-LICENSE"
cp "$repo_root/docker/sandbox/Dockerfile.control" "$build_root/control/Dockerfile"
(
  cd "$repo_root"
  CGO_ENABLED=0 GOOS=linux go build -trimpath -buildvcs=false -o "$build_root/runtime/antcdp-workspace-helper" ./cmd/antcdp-workspace-helper
)
cp "$repo_root/docker/sandbox/Dockerfile" "$build_root/runtime/Dockerfile"
docker build --build-arg "EXECD_BASE_IMAGE=$EXECD_BASE_IMAGE" -t "${ANTCDP_EXECD_IMAGE:-antcdp-execd:latest}" "$build_root/control"
docker build -t "${ANTCDP_SANDBOX_IMAGE:-antcdp-sandbox:latest}" "$build_root/runtime"
docker image inspect --format '{{.Id}}' "${ANTCDP_EXECD_IMAGE:-antcdp-execd:latest}" "${ANTCDP_SANDBOX_IMAGE:-antcdp-sandbox:latest}"
