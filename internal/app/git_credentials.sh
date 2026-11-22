# Privileged file operations accept only platform-generated connection and request IDs.
# No token is passed through process arguments or command output.
set -eu
umask 077
action=$1
conn=$2
request=$3
version=$4
uid=$5
host=$6
base=/run/platform/svc-creds
backing=/dev/shm/platform-svc-creds
private_dir() {
    [ ! -L "$1" ] && [ -d "$1" ] && [ "$(stat -c '%u:%a' "$1")" = "0:$2" ]
}
[ "$(id -u)" = 0 ] || exit 42
[ ! -L /run ] && [ "$(stat -c %u /run)" = 0 ] || exit 42
if [ ! -e /run/platform ]; then mkdir -m 755 /run/platform || [ -d /run/platform ]; fi
private_dir /run/platform 755 || exit 42
if [ ! -e "$base" ] || [ -L "$base" ]; then
    [ "$(stat -f -c %T /dev/shm)" = tmpfs ] || exit 42
    if [ ! -e "$backing" ]; then mkdir -m 711 "$backing" || [ -d "$backing" ]; fi
    private_dir "$backing" 711 || exit 42
    if [ ! -L "$base" ]; then ln -sT -- "$backing" "$base" || [ -L "$base" ]; fi
    [ "$(readlink "$base")" = "$backing" ] || exit 42
else
    private_dir "$base" 711 || exit 42
fi
[ "$(stat -fL -c %T "$base")" = tmpfs ] || exit 42
dir=$base/$conn
if [ "$action" = revoke ] && [ ! -e "$dir" ] && [ ! -L "$dir" ]; then exit 0; fi
if [ ! -e "$dir" ]; then mkdir -m 711 "$dir" || [ -d "$dir" ]; fi
private_dir "$dir" 711 || exit 42
cd -- "$dir"
exec 9<.
flock -x 9
case "$action" in
    revoke)
        changed=0
        if [ -e credentials ]; then changed=46; fi
        rm -f -- credentials version checksum gitconfig ca.pem pending
        rm -rf -- stage
        exit "$changed"
        ;;
    prepare)
        rm -rf -- stage
        rm -f -- pending
        if [ "$(cat version 2>/dev/null || :)" = "$version" ] && sha256sum -c --status checksum 2>/dev/null; then exit 0; fi
        mkdir -m 700 stage
        mkdir -m 700 "stage/$request"
        printf '%s' "$request" > pending
        exit 43
        ;;
    abort)
        if [ "$(cat pending 2>/dev/null || :)" = "$request" ]; then rm -rf -- stage; rm -f -- pending; fi
        ;;
    publish)
        [ "$(cat pending 2>/dev/null || :)" = "$request" ] || exit 45
        cd "stage/$request"
        [ -s credentials ] || exit 45
        : > gitconfig
        if [ -f ca.pem ]; then
            git config --file gitconfig "http.$host.sslCAInfo" "$dir/ca.pem"
            chmod 444 ca.pem
            mv -fT ca.pem "$dir/ca.pem"
        fi
        chmod 444 gitconfig
        mv -fT gitconfig "$dir/gitconfig"
        chown "$uid" credentials
        chmod 400 credentials
        mv -fT credentials "$dir/credentials"
        cd "$dir"
        sha256sum credentials gitconfig > checksum
        if git config --file gitconfig --get "http.$host.sslCAInfo" >/dev/null; then
            sha256sum ca.pem >> checksum
        else
            rm -f -- ca.pem
        fi
        printf '%s' "$version" > version
        rm -rf -- stage
        rm -f -- pending
        ;;
    *) exit 45 ;;
esac
