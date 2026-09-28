#!/usr/bin/env bash
set -Eeuo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
set -a; source "$ROOT/defaults.sh"; set +a
MODE=${1:?}; OUT=${2:?}; TARGET=${3:-}
WORK="$OUT/.guard"; mkdir -p "$WORK" "$OUT/evidence"
# Read large snapshots from files, preserving the existing evaluation rules.
printf '{}\n' > "$WORK/empty-http.json"
printf '%s\n' '$sample_file[0] as $s | $previous_file[0] as $prev | $baseline_file[0] as $baseline | $http_file[0] as $http |' > "$WORK/evaluate-inputs.jq"
cat "$ROOT/evaluate.jq" >> "$WORK/evaluate-inputs.jq"
record_stop() {
  local reasons=$1
  jq -n --argjson reasons "$reasons" --arg phase "$MODE" --argjson at "$(date +%s)" '{reasons:$reasons,phase:$phase,at:$at}' > "$OUT/evidence/watchdog.tmp"
  mv "$OUT/evidence/watchdog.tmp" "$OUT/evidence/watchdog.json"
}
stop_child() {
  [[ -n "$TARGET" ]] || return 0
  kill -INT "$TARGET" 2>/dev/null || return 0
  local until=$((SECONDS+STOP_GRACE_SECONDS))
  while kill -0 "$TARGET" 2>/dev/null && ((SECONDS<until)); do sleep 1; done
  if kill -0 "$TARGET" 2>/dev/null; then kill -TERM "$TARGET" 2>/dev/null || true; sleep 1; kill -KILL "$TARGET" 2>/dev/null || true; fi
}
on_error() { code=$?; trap - ERR; record_stop '["감시기 실행/해석 오류"]'; stop_child; exit "$code"; }
trap on_error ERR
if [[ "$MODE" == baseline ]]; then
  printf '{}\n' > "$WORK/previous.json"
  printf '{}\n' > "$WORK/baseline.json"
fi
begin=$SECONDS
while :; do
  if [[ "$MODE" == recovery ]] && (( $(date +%s) >= QUEUE_OBSERVE_UNTIL )); then exit 0; fi
  if [[ "$MODE" == running ]] && ! kill -0 "$TARGET" 2>/dev/null; then exit 0; fi
  "$ROOT/snapshot.sh" "$WORK/sample"
  HTTP_FILE="$WORK/empty-http.json"; [[ ! -s "$WORK/http.json" ]] || HTTP_FILE="$WORK/http.json"
  jq -cn --slurpfile sample_file "$WORK/sample/sample.json" --slurpfile previous_file "$WORK/previous.json" \
    --slurpfile baseline_file "$WORK/baseline.json" --slurpfile http_file "$HTTP_FILE" -f "$WORK/evaluate-inputs.jq" > "$WORK/current.json"
  jq -c . "$WORK/current.json" >> "$OUT/evidence/watch.jsonl"
  mv "$WORK/current.json" "$WORK/previous.json"
  if [[ "$MODE" == baseline ]]; then
    if ! jq -e '.preflight_ok' "$WORK/previous.json" >/dev/null; then
      reasons=$(jq -c '(.reasons + ["시작 전 Node/Ready/DB/관측 상태 미충족"])|unique' "$WORK/previous.json")
      record_stop "$reasons"; exit 20
    fi
    if [[ $(jq '.template==null' "$WORK/baseline.json") == true ]]; then cp "$WORK/previous.json" "$WORK/baseline.json"; fi
    if ((SECONDS-begin>=BASELINE_SECONDS)); then cp "$WORK/baseline.json" "$OUT/evidence/baseline.json"; exit 0; fi
  else
    if [[ "$MODE" == running ]]; then kill -0 "$TARGET" 2>/dev/null || exit 0; fi
    reasons=$(jq -c .reasons "$WORK/previous.json")
    if [[ "$reasons" != '[]' ]]; then record_stop "$reasons"; stop_child; exit 20; fi
    if [[ -f "$WORK/stream-failed" ]]; then record_stop '["k6 실시간 집계 경로 오류"]'; stop_child; exit 20; fi
  fi
  sleep "$WATCH_INTERVAL"
done
