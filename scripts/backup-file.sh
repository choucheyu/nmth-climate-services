#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: scripts/backup-file.sh <file> [reason]" >&2
  exit 64
fi

file="$1"
reason="${2:-manual-edit}"

if [[ ! -f "$file" ]]; then
  exit 0
fi

stamp="$(date +%Y%m%d-%H%M%S)"
target_dir="backups/$stamp"
mkdir -p "$target_dir/$(dirname "$file")"
cp "$file" "$target_dir/$file"
printf '%s\t%s\t%s\n' "$stamp" "$file" "$reason" >> backups/MANIFEST.tsv
