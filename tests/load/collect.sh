#!/usr/bin/env bash
set -Eeuo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
OUT=${1:?결과 디렉터리를 지정하세요}
DEST="$OUT/evidence/observations.jsonl"
: > "$DEST"
START=$(jq -r .start "$OUT/run.json")
END=$(jq -r .end "$OUT/run.json")
WINDOW=$((END - START))
((WINDOW > 0)) || WINDOW=1
for value in "${NAMESPACE:-app}" "${BACKEND_NAME:-backend}" "${EVENT_ID:-}" "${PROM_RATE_WINDOW:-1m}"; do
  [[ "$value" =~ ^[a-zA-Z0-9_.:-]*$ ]] || { echo '지표 라벨/기간에 지원하지 않는 문자가 있습니다.' >&2; exit 2; }
done
[[ ${PROM_STEP:-15} =~ ^[1-9][0-9]*$ ]] || { echo 'PROM_STEP은 양의 정수여야 합니다.' >&2; exit 2; }
while IFS= read -r row; do
  KEY=$(jq -r .key <<< "$row")
  TYPE=$(jq -r '.type // "range"' <<< "$row")
  QUERY=$(jq -r --arg ns "${NAMESPACE:-app}" --arg data "${DATA_NAMESPACE:-data}" --arg backend "${BACKEND_NAME:-backend}" --arg event "${EVENT_ID:-}" \
    --arg rate "${PROM_RATE_WINDOW:-1m}" --arg window "${WINDOW}s" \
    '.query | split("__NS__")|join($ns) | split("__DATA__")|join($data) | split("__BACKEND__")|join($backend) | split("__EVENT__")|join($event) | split("__RATE__")|join($rate) | split("__WINDOW__")|join($window)' <<< "$row")
  STATE=unconfigured
  printf 'null\n' > "$OUT/evidence/.prom.response.json"
  if [[ -n "$QUERY" && -n ${PROMETHEUS_URL:-} ]]; then
    args=(--data-urlencode "query=$QUERY")
    if [[ "$TYPE" == instant ]]; then endpoint=query; args+=(--data-urlencode "time=$END");
    else endpoint=query_range; args+=(--data-urlencode "start=$START" --data-urlencode "end=$END" --data-urlencode "step=${PROM_STEP:-15}"); fi
    STATE=error
    if curl -fsS --connect-timeout 3 --max-time 10 -G "${PROMETHEUS_URL%/}/api/v1/$endpoint" "${args[@]}" > "$OUT/evidence/.prom.tmp" 2>/dev/null; then
      if jq -e '.status=="success" and (.data.result|type=="array")' "$OUT/evidence/.prom.tmp" >/dev/null 2>&1; then
        cp "$OUT/evidence/.prom.tmp" "$OUT/evidence/.prom.response.json"
        STATE=measured
        [[ $(jq '.data.result|length' "$OUT/evidence/.prom.response.json") != 0 ]] || STATE=missing
      fi
    fi
  fi
  jq -cn --argjson spec "$row" --arg query "$QUERY" --arg state "$STATE" --slurpfile response "$OUT/evidence/.prom.response.json" \
    '$spec + {query:$query,state:$state,response:$response[0]}' >> "$DEST"
done < <(jq -c '.[]' "${METRICS_FILE:-$ROOT/metrics.json}")
rm -f "$OUT/evidence/.prom.tmp" "$OUT/evidence/.prom.response.json"
