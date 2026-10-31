#!/usr/bin/env bash
# Restore the immediately preceding release from an authenticated deployment backup.
set -Eeuo pipefail
umask 077
id="${1:-}"
[[ "$id" =~ ^[0-9]+-[0-9]+$ ]] || { echo 'Invalid rollback ID' >&2; exit 2; }
[[ -n "${HOME:-}" && -d "$HOME" ]] || exit 2
web="$HOME/alext.io"
state="$HOME/.alext-deploy"
backup="$state/backups/$id"
[[ -d "$web" && ! -L "$web" && ! -L "$state" && -f "$backup/ready" ]] || exit 2
[[ -f "$state/current-deploy-id" ]] || exit 2
[[ "$(cat "$state/current-deploy-id")" == "$id" ]] || { echo 'Only the latest deployment can be rolled back' >&2; exit 2; }
[[ ! -e "$backup/rolled-back" ]] || exit 2
command -v flock >/dev/null || exit 2
exec 9>"$state/deploy.lock"
flock -w 30 9
[[ "$(cat "$state/current-deploy-id")" == "$id" ]] || exit 2
# Reject unexpected filenames and symlinks, including any potentially modified directories.
safe_path() {
  local rel="$1" node="$web" part
  case "$rel" in ''|/*|.*|*/.*|*'..'*|*'\'*|*$'\n'*|*$'\r'*) return 1;; esac
  case "$rel" in index.html|js/*|images/*|fonts/*|public/css/*|public/files/*|public/fonts/*|public/images/*) ;; *) return 1;; esac
  IFS=/ read -r -a components <<< "$rel"
  for part in "${components[@]}"; do
    [[ -n "$part" && "$part" != . && "$part" != .. ]] || return 1
    node="$node/$part"
    [[ ! -L "$node" ]] || return 1
  done
  [[ ! -e "$node" || -f "$node" ]] || return 1
}
while IFS= read -r rel; do
  safe_path "$rel" && [[ -f "$backup/files/$rel" && ! -L "$backup/files/$rel" ]] || exit 3
done < "$backup/existing.txt"
while IFS= read -r rel; do safe_path "$rel" || exit 3; done < "$backup/created.txt"
# Fail closed on missing previous release metadata.
[[ -f "$backup/deployed-manifest.txt" && -f "$backup/existing.txt" && -f "$backup/created.txt" ]] || exit 3
while IFS= read -r rel; do
  target="$web/$rel"
  tmp="$(mktemp "${target}.alext-restore.XXXXXX")"
  cp -p -- "$backup/files/$rel" "$tmp"
  mv -f -- "$tmp" "$target"
done < "$backup/existing.txt"
while IFS= read -r rel; do rm -f -- "$web/$rel"; done < "$backup/created.txt"
if [[ -e "$backup/had-manifest" ]]; then
  cp -- "$backup/previous-manifest.txt" "$state/current-manifest.txt"
else
  rm -f -- "$state/current-manifest.txt"
fi
if [[ -e "$backup/had-id" ]]; then
  cp -- "$backup/previous-deploy-id" "$state/current-deploy-id"
else
  rm -f -- "$state/current-deploy-id"
fi
: > "$backup/rolled-back"
echo "Rolled back release $id"
