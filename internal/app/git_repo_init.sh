# Arguments are supplied through exec argv. Run with the sandbox execution identity.
set -eu
target=$1
origin=$2
host=$3
conn=$4
name=$5
email=$6
root=/run/platform/svc-creds/$conn
helper="!f() { if test \"\$1\" = get; then git credential-store --file=$root/credentials get; fi; }; f"
write_identity() {
    git config --file "$1" --replace-all -- user.name "$name"
    git config --file "$1" --replace-all -- user.email "$email"
}
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
    worktree=$(git rev-parse --show-toplevel 2>/dev/null) || exit 41
    [ "$(cd -- "$worktree" && pwd -P)" = "$target" ] || exit 41
    config=.git/config
    [ -f "$config" ] && [ ! -L "$config" ] || exit 41
    lock=$config.lock
    (set -C; : > "$lock") 2>/dev/null || exit 47
    stage=
    trap 'if [ -n "$stage" ]; then rm -rf -- "$stage"; fi; rm -f -- "$lock"' EXIT
    [ "$(git config --file "$config" --get-all remote.origin.url)" = "$origin" ] || exit 41
    [ "$(git config --file "$config" --get platform.connection)" = "$conn" ] || exit 41
    [ "$(git config --file "$config" --get-all "credential.$host.helper")" = "$(printf '\n%s' "$helper")" ] || exit 41
    git config --file "$config" --get-all include.path | grep -Fxq -- "$root/gitconfig" || exit 41
    # Publish both identity fields together while holding Git's config lock.
    stage=$(mktemp -d .git/.config-init.XXXXXXXX)
    cp -p -- "$config" "$stage/config"
    write_identity "$stage/config"
    mv -T -- "$stage/config" "$config"
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
write_identity "$config"
mv -T -- "$stage/.git" .git
printf '%s\n' "$target"
