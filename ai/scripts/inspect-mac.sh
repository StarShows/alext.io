#!/bin/sh
# Read-only discovery. No installs, secret reads, filesystem edits or settings changes.
set -u
if [ "$(uname -s)" != Darwin ]; then
  printf '%s\n' 'Run this on the Mac mini that will host the assistant, not a different computer.' >&2
  exit 1
fi
printf '\n== Mac hardware (no serial number) ==\n'
printf 'Model: '; sysctl -n hw.model
printf 'Architecture: '; uname -m
printf 'Processor: '; sysctl -n machdep.cpu.brand_string 2>/dev/null || true
printf 'Memory bytes: '; sysctl -n hw.memsize
printf 'Logical CPUs: '; sysctl -n hw.logicalcpu
printf '\n== macOS ==\n'; sw_vers
printf '\n== Available disk ==\n'; df -h / | awk 'NR==1 {print "Size Used Available Capacity"} NR==2 {print $2,$3,$4,$5}'
printf '\n== Docker versions and resources ==\n'
if command -v docker >/dev/null 2>&1; then
  docker version --format 'Client={{.Client.Version}} Server={{.Server.Version}}' 2>/dev/null || printf '%s\n' 'Docker is installed but its engine is unavailable.'
  docker info --format 'Architecture={{.Architecture}} CPUs={{.NCPU}} MemoryBytes={{.MemTotal}}' 2>/dev/null || true
  printf '\nRunning containers (review names before sharing):\n'
  docker ps --format 'Image={{.Image}} Status={{.Status}} Ports={{.Ports}}' 2>/dev/null || true
  printf '\nExisting Docker network subnets:\n'
  for id in $(docker network ls -q 2>/dev/null); do docker network inspect --format '{{range .IPAM.Config}}{{.Subnet}} {{end}}' "$id" 2>/dev/null || true; done
else printf '%s\n' 'Docker command is not installed.'; fi
printf '\n== Ollama ==\n'
if command -v ollama >/dev/null 2>&1; then
  ollama --version 2>/dev/null || true
  ollama list 2>/dev/null || printf '%s\n' 'Ollama is installed but not reachable at its current local address.'
  ollama ps 2>/dev/null || true
else printf '%s\n' 'Ollama command is not installed.'; fi
printf '\n== Selected listening ports only ==\n'
for port in 11434 18080 19091 2000; do
  printf 'Port %s: ' "$port"
  result=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -F n 2>/dev/null | sed -n 's/^n//p')
  if [ -n "$result" ]; then printf '%s\n' "$result"; else printf '%s\n' 'not observed (permissions may limit visibility)'; fi
done
printf '\n== Outbound HTTPS reachability ==\n'
for url in https://registry.ollama.ai/v2/ https://www.cloudflare.com/; do
  curl --connect-timeout 5 --max-time 10 -sS -o /dev/null -w 'HTTP status: %{http_code}\n' "$url" 2>/dev/null || printf '%s\n' 'Connection unavailable.'
done
printf '\n== Current sleep settings (read-only) ==\n'; pmset -g custom 2>/dev/null || true
printf '\nDiscovery complete. Review output and redact anything sensitive before sharing. No configuration was changed.\n'
