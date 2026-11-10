#!/bin/sh
# Isolated CI-only container verification. This never connects to an owner machine.
set -eu
cd "$(dirname "$0")/.."
case "${GITHUB_ACTIONS:-}" in true) ;; *) printf '%s\n' 'This script is restricted to the hosted CI verification environment.' >&2; exit 1;; esac
mkdir -p reports secrets
printf '%s' 'isolated-container-smoke-secret-not-a-provider-credential' > secrets/smoke-secret
chmod 444 secrets/smoke-secret
name="alext-ai-smoke-${GITHUB_RUN_ID}"
trap 'docker rm -f "$name" >/dev/null 2>&1 || true; rm -f secrets/smoke-secret' EXIT INT TERM
docker build --build-arg NODE_IMAGE=node:24.20.0-bookworm-slim -t alext-ai-ci:smoke .
docker run -d --name "$name" --read-only --cap-drop ALL --security-opt no-new-privileges:true --network none --user 10001:10001 --memory 512m --pids-limit 128 --tmpfs /tmp:size=16m,noexec,nosuid,nodev -v "$(pwd)/secrets/smoke-secret:/run/secrets/turnstile:ro" -e TURNSTILE_SECRET_FILE=/run/secrets/turnstile -e OLLAMA_MODEL=fixture:1b -e OLLAMA_MODEL_DIGEST=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa alext-ai-ci:smoke >/dev/null
ready=no
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if docker exec "$name" node -e "fetch('http://127.0.0.1:18080/v1/health',{signal:AbortSignal.timeout(2000)}).then(r=>process.exit(r.status===503?0:1)).catch(()=>process.exit(1))"; then ready=yes; break; fi
  sleep 2
done
test "$ready" = yes
docker exec "$name" node -e "const a=require('node:assert/strict'),f=require('node:fs');a.equal(process.getuid(),10001);a(!f.existsSync('/var/run/docker.sock'));a.throws(()=>f.writeFileSync('/app/not-writable','x'));Promise.all([fetch('http://127.0.0.1:18080/api/tags'),fetch('http://127.0.0.1:18080/metrics')]).then(rs=>{rs.forEach(r=>a.equal(r.status,404));console.log('Non-root, read-only, no Docker socket, unavailable-model fallback and forbidden endpoints verified.');}).catch(()=>process.exit(1))"
docker image inspect alext-ai-ci:smoke --format '{{.Id}}' > reports/container-image-id.txt
