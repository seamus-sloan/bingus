#!/bin/sh
# PUID/PGID entrypoint, linuxserver.io-style (same pattern as omnibus). The
# container starts as root so it can remap the unprivileged `bingus` user to
# the host UID/GID the operator wants, fix ownership of the data volume, then
# drop privileges before exec'ing the server. Defaults to 1000:1000.
set -e

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

# `-o` allows non-unique ids (e.g. sharing 1000 with another account); these
# are no-ops when the ids already match.
groupmod -o -g "$PGID" bingus
usermod  -o -u "$PUID" bingus

# Own the volume mount root — the server creates the SQLite file itself.
chown bingus:bingus /data 2>/dev/null || true

echo "bingus: starting as uid=${PUID} gid=${PGID}"
exec gosu bingus:bingus "$@"
