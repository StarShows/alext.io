#!/usr/bin/env bash
# Executed over authenticated SSH. Never run as root or from the web root.
set -Eeuo pipefail
umask 077

id="${1:-}"
[[ "$id" =~ ^[0-9]+-[0-9]+$ ]] || { echo 'Invalid deployment ID' >&2; exit 2; }
[[ -n "${HOME:-}" && -d "$HOME" ]] || exit 2
web="$HOME/alext.io"
state="$HOME/.alext-deploy"
incoming="$state/staging/$id/site.tar.gz"
stage="$state/work/$id"
backup="$state/backups/$id"
current="$state/current-manifest.txt"
current_id="$state/current-deploy-id"
[[ -d "$web" && ! -L "$web" && ! -L "$state" ]] || { echo 'Unsafe deployment root' >&2; exit 2; }
[[ -f "$incoming" && ! -L "$incoming" && ! -e "$backup" ]] || { echo 'Missing archive or duplicate deployment' >&2; exit 2; }
command -v flock >/dev/null || { echo 'flock is required' >&2; exit 2; }
mkdir -p "$state" "$state/work" "$state/backups"
exec 9>"$state/deploy.lock"
flock -w 30 9
mkdir -p "$stage" "$backup/files"

safe_path() {
  local rel="$1" part dir="$web" ext
  case "$rel" in ''|/*|.*|*/.*|*'..'*|*'\'*|*$'\n'*|*$'\r'*) return 1;; esac
  case "$rel" in
    index.html) ;;
    js/*|images/*|fonts/*|public/css/*|public/files/*|public/fonts/*|public/images/*) ;;
    *) return 1 ;;
  esac
  if [[ "$rel" != index.html ]]; then
    ext="${rel##*.}"; ext="${ext,,}"
    case "$ext" in js|html|css|map|png|jpg|jpeg|svg|webp|gif|avif|ico|woff|woff2|ttf|otf|eot|pdf|docx|json) ;;
      *) return 1 ;;
    esac
  fi
  IFS=/ read -r -a components <<< "$rel"
  for part in "${components[@]}"; do
    [[ -n "$part" && "$part" != . && "$part" != .. ]] || return 1
    dir="$dir/$part"
    [[ ! -L "$dir" ]] || return 1
  done
  [[ ! -e "$dir" || -f "$dir" ]] || return 1
}

# Check archive member names and types BEFORE extraction to prevent symlink traversal.
if tar -tvzf "$incoming" | grep -Ev '^-' | grep -q .; then
  echo 'Archive contains a non-regular entry' >&2
  exit 3
fi
while IFS= read -r entry; do
  case "$entry" in
    manifest.txt|SHA256SUMS) ;;
    site/*) safe_path "${entry#site/}" || { echo "Invalid archive entry: $entry" >&2; exit 3; } ;;
    *) echo "Unexpected archive entry: $entry" >&2; exit 3 ;;
  esac
done < <(tar -tzf "$incoming")

tar -xzf "$incoming" -C "$stage" --no-same-owner --no-same-permissions
[[ -f "$stage/manifest.txt" && -f "$stage/SHA256SUMS" && -d "$stage/site" ]] || exit 3
[[ ! -L "$stage/site" ]] || exit 3
if find "$stage" -type l | grep -q .; then echo 'Archive contains symlinks' >&2; exit 3; fi
(cd "$stage" && sha256sum --check --status SHA256SUMS)
LC_ALL=C sort -u "$stage/manifest.txt" > "$stage/manifest.sorted"
cmp -s "$stage/manifest.txt" "$stage/manifest.sorted" || { echo 'Unsorted or duplicate manifest' >&2; exit 3; }
find "$stage/site" -type f -printf '%P\n' | LC_ALL=C sort > "$stage/actual.txt"
cmp -s "$stage/actual.txt" "$stage/manifest.txt" || { echo 'Manifest mismatch' >&2; exit 3; }
grep -qx 'index.html' "$stage/manifest.txt" || exit 3
while IFS= read -r rel; do
  safe_path "$rel" && [[ -f "$stage/site/$rel" ]] || { echo "Unsafe path: $rel" >&2; exit 3; }
done < "$stage/manifest.txt"

ready=0
committed=0
recover() {
  local status="$1" rel
  trap - ERR
  set +e
  if [[ "$ready" == 1 && "$committed" == 0 ]]; then
    echo 'Deployment failed. Restoring prior files...' >&2
    while IFS= read -r rel; do
      mkdir -p "$(dirname "$web/$rel")"
      cp -p -- "$backup/files/$rel" "$web/$rel"
    done < "$backup/existing.txt"
    while IFS= read -r rel; do rm -f -- "$web/$rel"; done < "$backup/created.txt"
    if [[ -e "$backup/had-manifest" ]]; then
      cp -- "$backup/previous-manifest.txt" "$current"
    else
      rm -f -- "$current"
    fi
    if [[ -e "$backup/had-id" ]]; then
      cp -- "$backup/previous-deploy-id" "$current_id"
    else
      rm -f -- "$current_id"
    fi
  fi
  exit "$status"
}
trap 'recover $?' ERR
trap 'rm -rf -- "$stage"' EXIT

: > "$backup/existing.txt"
: > "$backup/created.txt"
if [[ -f "$current" ]]; then cp -p -- "$current" "$backup/previous-manifest.txt"; : > "$backup/had-manifest"; fi
if [[ -f "$current_id" ]]; then cp -p -- "$current_id" "$backup/previous-deploy-id"; : > "$backup/had-id"; fi
cp -- "$stage/manifest.txt" "$backup/deployed-manifest.txt"
while IFS= read -r rel; do
  target="$web/$rel"
  if [[ -f "$target" ]]; then
    mkdir -p "$(dirname "$backup/files/$rel")"
    cp -p -- "$target" "$backup/files/$rel"
    printf '%s\n' "$rel" >> "$backup/existing.txt"
  else
    printf '%s\n' "$rel" >> "$backup/created.txt"
  fi
done < "$stage/manifest.txt"
: > "$backup/ready"
ready=1

install_one() {
  local rel="$1" target="$web/$1" temp
  safe_path "$rel" || return 1
  mkdir -p "$(dirname "$target")"
  temp="$(mktemp "${target}.alext-tmp.XXXXXX")"
  cp -- "$stage/site/$rel" "$temp"
  chmod 0644 "$temp"
  mv -f -- "$temp" "$target"
  cmp -s -- "$stage/site/$rel" "$target"
}

# Assets first, homepage last, so new HTML never points at files not yet uploaded.
while IFS= read -r rel; do [[ "$rel" == index.html ]] || install_one "$rel"; done < "$stage/manifest.txt"
install_one index.html
cp -- "$stage/manifest.txt" "$current.tmp.$id"
mv -f -- "$current.tmp.$id" "$current"
printf '%s\n' "$id" > "$current_id.tmp.$id"
mv -f -- "$current_id.tmp.$id" "$current_id"
committed=1
printf 'Deployed %s static files, release %s\n' "$(wc -l < "$current")" "$id"
find "$state/backups" -mindepth 1 -maxdepth 1 -type d -mtime +30 -exec rm -rf -- {} + || true
rm -f -- "$incoming" || true
