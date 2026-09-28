#!/usr/bin/env bash
set -Eeuo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
OUT=${1:?결과 디렉터리를 지정하세요}
append_guard() {
  if [[ -f "$OUT/evidence/watchdog.json" ]]; then
    jq -r '"\n자동 중단/시작 차단: " + (.reasons|join("; "))' "$OUT/evidence/watchdog.json" >> "$OUT/report.md"
  fi
}
trap append_guard EXIT
for file in "$OUT/run.json" "$OUT/evidence/k6-summary.json" "$OUT/evidence/observations.jsonl"; do
  if [[ ! -f "$file" ]]; then
    # Do not fabricate zero measurements after initialization failure / interruption.
    printf '# 부하시험 결과\n\n실패 또는 중단으로 집계가 불완전합니다. evidence/k6.log와 run.json을 확인하세요.\n' > "$OUT/report.md"
    exit 0
  fi
done
jq -nr --slurpfile run "$OUT/run.json" --slurpfile k6 "$OUT/evidence/k6-summary.json" \
  --slurpfile obs "$OUT/evidence/observations.jsonl" -f "$ROOT/report.jq" > "$OUT/report.md"
if [[ -f "$OUT/evidence/db-result.json" ]]; then
  jq -r '"\nDB 읽기 검증: " + (.verdict // "미측정") + ". evidence/db-result.json 참고."' "$OUT/evidence/db-result.json" >> "$OUT/report.md"
fi
