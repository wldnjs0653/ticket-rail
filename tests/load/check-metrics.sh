#!/usr/bin/env bash
set -Eeuo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
OUT=${1:?}; MODE=${2:-load}
# Probe the same queries the final report uses; never synthesize absent values.
TMP="$OUT/.metric-check"; mkdir -p "$TMP/evidence"
now=$(date +%s)
jq -n --argjson now "$now" '{start:($now-120),end:$now}' > "$TMP/run.json"
"$ROOT/collect.sh" "$TMP"
cp "$TMP/evidence/observations.jsonl" "$OUT/evidence/metric-check.jsonl"
failed=0
while IFS= read -r row; do
  key=$(jq -r .key <<< "$row")
  section=$(jq -r .section <<< "$row")
  ok=$(jq -r '[.response.data.result[]? | (.values // [.value])[]? | .[1] | try tonumber catch null | select(.!=null and (isnan|not) and (isinfinite|not))] | length>0' <<< "$row")
  if [[ "$ok" != true ]]; then
    jq -r '"지표 확인 필요: " + .key + " (" + .label + ") — " + .state' <<< "$row" >&2
    if [[ "$MODE" == load || "$MODE" == queue ]]; then
      if [[ ( ${REQUIRE_PLAN_METRICS:-1} == 1 && "$section" =~ ^(api|plan)$ ) || "$key" =~ ^(replicas|cpu|memory|hpa|hpa_desired|api_rps|api_completed)$ || ( "$MODE" == queue && "$key" == queue_depth ) ]]; then failed=1; fi
    fi
  fi
done < "$OUT/evidence/metric-check.jsonl"
rm -rf -- "$TMP"
exit "$failed"
