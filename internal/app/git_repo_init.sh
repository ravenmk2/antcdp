# Arguments are supplied through exec argv. Run with the sandbox execution identity.
set -eu
target=$1
origin=$2
host=$3
conn=$4
root=/run/platform/svc-creds/$conn
helper="!f() { if test \"\$1\" = get; then git credential-store --file=$root/credentials get; fi; }; f"
command -v git >/dev/null || exit 44
target=$(realpath -m -- "$target")
case "$target/" in /run/platform/*|/dev/shm/platform-svc-creds/*) exit 41;; esac
mkdir -p -- "$target"
cd -- "$target"
target=$(pwd -P)
case "$target/" in /run/platform/*|/dev/shm/platform-svc-creds/*) exit 41;; esac
# Lock the directory inode. No extra worktree files survive initialization.
exec 9<.
flock -x 9
if [ -e .git ] || [ -L .git ]; then
    [ -d .git ] && [ ! -L .git ] || exit 41
    [ "$(git rev-parse --show-toplevel 2>/dev/null)" = "$target" ] || exit 41
    config=.git/config
    [ "$(git config --file "$config" --get-all remote.origin.url)" = "$origin" ] || exit 41
    [ "$(git config --file "$config" --get platform.connection)" = "$conn" ] || exit 41
    [ "$(git config --file "$config" --get-all "credential.$host.helper")" = "$(printf '\n%s' "$helper")" ] || exit 41
    git config --file "$config" --get-all include.path | grep -Fxq -- "$root/gitconfig" || exit 41
    printf '%s\n' "$target"
    exit 0
fi
[ -z "$(find . -mindepth 1 -maxdepth 1 -print -quit)" ] || exit 41
# Prefer the parent so an interrupted preparation leaves the target reusable.
# A mount root or a read-only parent requires staging inside the empty target.
parent=$(dirname -- "$target")
if [ -w "$parent" ] && [ "$(stat -c %d .)" = "$(stat -c %d "$parent")" ]; then
    stage=$(mktemp -d -- "$parent/.git-init.XXXXXXXX")
else
    stage=$(mktemp -d .git-init.XXXXXXXX)
fi
trap 'rm -rf -- "$stage"' EXIT
git init -q --template= -- "$stage"
config="$stage/.git/config"
git config --file "$config" remote.origin.url "$origin"
git config --file "$config" remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*'
git config --file "$config" platform.connection "$conn"
git config --file "$config" --add "credential.$host.helper" ''
git config --file "$config" --add "credential.$host.helper" "$helper"
git config --file "$config" --add include.path "$root/gitconfig"
mv -T -- "$stage/.git" .git
printf '%s\n' "$target"
