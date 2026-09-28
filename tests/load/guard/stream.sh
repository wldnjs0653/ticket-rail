#!/usr/bin/env bash
set -Eeuo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# The runner owns the FIFO and passes its absolute path. The latest aggregate is atomic.
jq -cn --unbuffered -f "$ROOT/stream.jq" < "$1" |
while IFS= read -r line; do
  printf '%s\n' "$line" > "$2.tmp"
  mv "$2.tmp" "$2"
done
