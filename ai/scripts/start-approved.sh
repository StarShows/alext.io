#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if [ "${AI_START_APPROVED:-}" != yes ]; then
  printf '%s\n' 'Blocked: obtain explicit owner approval before starting public infrastructure.' >&2
  exit 1
fi
node --env-file=.env scripts/preflight.mjs
docker compose --env-file .env config --quiet
docker compose --env-file .env up -d --no-build --wait --wait-timeout 90 gateway ollama tunnel
printf '%s\n' 'Containers started. Run the external security and real-browser acceptance checks before enabling the widget.'
