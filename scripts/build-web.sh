#!/usr/bin/env bash
# Build and verify the frontend before Go embeds web/dist.
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/build-web.mjs
