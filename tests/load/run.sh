#!/usr/bin/env bash
set -Eeuo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
CONFIG_FILE=${CONFIG_FILE:-"$ROOT/config.env"}
[[ -f "$CONFIG_FILE" ]] || { echo 'config.env.example을 config.env로 복사하거나 import-config.sh로 기존 설정을 가져오세요.' >&2; exit 2; }
set -a; source "$CONFIG_FILE"; source "$ROOT/guard/defaults.sh"; set +a
export TZ=UTC
MODE=${1:-smoke}; CHECK_ONLY=0
if [[ "$MODE" == check ]]; then MODE=${2:-load}; CHECK_ONLY=1; fi
case "$MODE" in
 smoke|load|e2e) SCENARIO=$MODE;; queue) SCENARIO=queue-backlog;; concurrency) SCENARIO=seat-concurrency;;
 *) echo '사용법: ./run.sh [check] smoke|load|queue|e2e|concurrency' >&2; exit 2;;
esac
for bin in bash k6 jq curl date setsid kubectl timeout awk df mkfifo getent; do
 command -v "$bin" >/dev/null || { echo "필요한 명령: $bin" >&2; exit 2; }
done
export BASE_URL; BASE_URL=$("$ROOT/resolve-endpoint.sh")
export RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
OUT=${RUN_OUTPUT_DIR:-"$ROOT/results/$RUN_ID-$MODE"}
[[ "$OUT" == /* && ! -e "$OUT/run.json" && ! -e "$OUT/.guard" ]] || { echo '결과 디렉터리는 미사용 절대 경로여야 합니다.' >&2; exit 2; }
mkdir -p "$OUT/evidence" "$OUT/.guard"
export SUMMARY_PATH="$OUT/evidence/k6-summary.json"
export K6_SUMMARY_TREND_STATS='avg,min,med,max,p(90),p(95),p(99)'
# Guard requires expected_response; preserve the remaining standard k6 system tags.
export K6_SYSTEM_TAGS='proto,subproto,status,method,url,name,group,check,error,error_code,tls_version,scenario,service,expected_response'
unset K6_SUMMARY_MODE
child=''; guard=''; stream=''; forward=''; interrupted=0
cleanup() {
 trap - EXIT
 for pid in "$guard" "$stream"; do [[ -z "$pid" ]] || kill -TERM -- "-$pid" 2>/dev/null || true; done
 [[ -z "$child" ]] || kill -TERM "$child" 2>/dev/null || true
 [[ -z "$forward" ]] || kill -TERM "$forward" 2>/dev/null || true
 rm -rf -- "$OUT/.guard"
}
trap cleanup EXIT
stop_run() {
 interrupted=1
 if [[ -n "$child" ]]; then kill -INT "$child" 2>/dev/null || true
 elif [[ -n "$guard" ]]; then kill -TERM -- "-$guard" 2>/dev/null || true; fi
}
trap stop_run INT TERM
START=$(date +%s)
jq -n --arg mode "$MODE" --arg run "$RUN_ID" --arg url "$BASE_URL" --arg event "${EVENT_ID:-}" --arg target "${TARGET_PATH:-}" --argjson start "$START" \
 '{mode:$mode,run_id:$run,base_url:$url,event_id:$event,target:$target,start:$start,stage:"preflight",tls_verification:true}' > "$OUT/run.json"
end_meta() {
 jq --argjson end_ts "$(date +%s)" --argjson code "$1" --arg stage "$2" '. + {end:$end_ts,exit_code:$code,stage:$stage}' "$OUT/run.json" > "$OUT/run.tmp"
 mv "$OUT/run.tmp" "$OUT/run.json"
}
if [[ ${MANAGE_PROMETHEUS_FORWARD:-0} == 1 ]] && ! curl -fsS --max-time 3 "${PROMETHEUS_URL%/}/-/ready" >/dev/null 2>&1; then
 [[ "$PROMETHEUS_URL" =~ ^http://127\.0\.0\.1:([0-9]+)$ ]] || { echo '자동 포트포워딩에는 Prometheus URL이 http://127.0.0.1:포트 형식이어야 합니다.' >&2; exit 2; }
 kubectl -n "$MONITORING_NAMESPACE" port-forward "svc/${PROMETHEUS_SERVICE:-prometheus-stack-kube-prom-prometheus}" "${BASH_REMATCH[1]}:9090" --address=127.0.0.1 > "$OUT/evidence/port-forward.log" 2>&1 & forward=$!
 for ((i=0;i<10;i++)); do curl -fsS --max-time 2 "${PROMETHEUS_URL%/}/-/ready" >/dev/null 2>&1 && break; sleep 1; done
fi
echo "사전 점검: $MODE | 결과: $OUT/report.md"
if ! "$ROOT/check-metrics.sh" "$OUT" "$MODE" 2> "$OUT/evidence/preflight.log"; then
 cat "$OUT/evidence/preflight.log" >&2
 printf '{"reasons":["필수 시험 지표 미설정·미수집 — preflight.log 확인"],"phase":"preflight"}\n' > "$OUT/evidence/watchdog.json"
 end_meta 20 preflight; "$ROOT/report.sh" "$OUT"; exit 20
fi
cat "$OUT/evidence/preflight.log"
if [[ "$CHECK_ONLY" == 1 ]]; then export BASELINE_SECONDS=0; fi
if ! "$ROOT/guard/watch.sh" baseline "$OUT"; then end_meta 20 baseline; "$ROOT/report.sh" "$OUT"; exit 20; fi
if [[ "$CHECK_ONLY" == 1 ]]; then
 end_meta 0 checked
 printf '# 사전 점검\n\nDNS·HTTPS 접속·필수 지표·Node·Backend Ready·DB·감시 경로 확인 완료. 부하는 실행하지 않았습니다.\n' > "$OUT/report.md"
 echo "사전 점검 완료: $OUT/report.md"; exit 0
fi
if [[ "$interrupted" == 1 ]]; then end_meta 130 interrupted; "$ROOT/report.sh" "$OUT"; exit 130; fi
START=$(date +%s)
jq --argjson start "$START" '.start=$start | .stage="running"' "$OUT/run.json" > "$OUT/run.tmp"; mv "$OUT/run.tmp" "$OUT/run.json"
mkfifo "$OUT/.guard/points.fifo"
# FIFO consumes granular k6 points without retaining a large raw-point file.
setsid bash -c '"$1" "$2" "$3" || { touch "$4"; exit 1; }' _ "$ROOT/guard/stream.sh" "$OUT/.guard/points.fifo" "$OUT/.guard/http.json" "$OUT/.guard/stream-failed" > "$OUT/evidence/stream.log" 2>&1 & stream=$!
args=(--out "json=$OUT/.guard/points.fifo")
if [[ -n ${K6_OUT:-} ]]; then args+=(--out "$K6_OUT"); fi
set +e
args+=(--tag "testid=$RUN_ID" --tag "run_id=$RUN_ID" --tag "dashboard_test=$SCENARIO")
setsid k6 run --log-format raw --insecure-skip-tls-verify=false "${args[@]}" "$ROOT/k6/scenarios/$SCENARIO.js" > "$OUT/evidence/k6.log" 2>&1 & child=$!
setsid "$ROOT/guard/watch.sh" running "$OUT" "$child" > "$OUT/evidence/guard.log" 2>&1 & guard=$!
printf '%s\n' "$guard" > "$OUT/.guard/watch.pid"
deadline=0
while kill -0 "$child" 2>/dev/null; do
 if ! kill -0 "$guard" 2>/dev/null && [[ ! -f "$OUT/evidence/watchdog.json" ]]; then
  printf '{"reasons":["감시기 예기치 않은 종료"],"phase":"running"}\n' > "$OUT/evidence/watchdog.json"
  kill -INT "$child" 2>/dev/null
  deadline=$((SECONDS+STOP_GRACE_SECONDS))
 fi
 if [[ "$interrupted" == 1 ]] && ((deadline==0)); then deadline=$((SECONDS+STOP_GRACE_SECONDS)); fi
 if [[ -f "$OUT/evidence/watchdog.json" ]] && ! kill -0 "$guard" 2>/dev/null && ((deadline==0)); then
  kill -INT "$child" 2>/dev/null; deadline=$((SECONDS+STOP_GRACE_SECONDS))
 fi
 if ((deadline>0 && SECONDS>=deadline)); then
  kill -TERM "$child" 2>/dev/null; sleep 1; kill -KILL "$child" 2>/dev/null; break
 fi
 sleep 1
done
wait "$child"; RC=$?
if [[ "$interrupted" == 1 ]]; then
 until=$((SECONDS+STOP_GRACE_SECONDS))
 while kill -0 "$child" 2>/dev/null && ((SECONDS<until)); do sleep 1; done
 kill -TERM "$child" 2>/dev/null || true; sleep 1; kill -KILL "$child" 2>/dev/null || true
 wait "$child" 2>/dev/null; RC=130
fi
child=''
# Give the stream time to consume the final flush; then cleanly terminate helpers.
for ((i=0;i<3;i++)); do kill -0 "$stream" 2>/dev/null || break; sleep 1; done
kill -TERM -- "-$guard" 2>/dev/null; wait "$guard" 2>/dev/null; guard=''
kill -TERM -- "-$stream" 2>/dev/null; wait "$stream" 2>/dev/null; stream=''
set -e
if [[ -f "$OUT/.guard/stream-failed" && ! -f "$OUT/evidence/watchdog.json" ]]; then
 printf '{"reasons":["k6 실시간 집계 경로 오류"],"phase":"running"}\n' > "$OUT/evidence/watchdog.json"
fi
if [[ -f "$SUMMARY_PATH" ]] && jq -e '(.metrics.dropped_iterations.values.count // 0)>0' "$SUMMARY_PATH" >/dev/null; then
 [[ -f "$OUT/evidence/watchdog.json" ]] || printf '{"reasons":["k6 dropped_iterations 발생"],"phase":"completion"}\n' > "$OUT/evidence/watchdog.json"
fi
if [[ -f "$OUT/evidence/watchdog.json" ]]; then RC=20; fi
if [[ "$MODE" == queue && "$RC" == 0 ]]; then
 # k6 may finish when arrivals reach zero. Keep the planned recovery observation.
 duration=$(jq -R 'fromjson? | select(.type=="queue_plan") | .duration_seconds' "$OUT/evidence/k6.log" | tail -1)
 if [[ -n "$duration" ]]; then
  origin=$START
  if [[ -f "$OUT/.guard/http.json" ]]; then origin=$(jq -r --argjson start "$START" '.started // $start' "$OUT/.guard/http.json"); fi
  export QUEUE_OBSERVE_UNTIL
  QUEUE_OBSERVE_UNTIL=$(jq -nr --argjson origin "$origin" --argjson duration "$duration" '$origin+$duration|ceil')
  if (( $(date +%s) < QUEUE_OBSERVE_UNTIL )); then
   echo '신규 유입 종료. 계획된 큐 회복 구간의 서버 관측을 계속합니다.'
   setsid "$ROOT/guard/watch.sh" recovery "$OUT" >> "$OUT/evidence/guard.log" 2>&1 & guard=$!
   set +e; wait "$guard"; recovery_rc=$?; set -e
   guard=''
   if [[ "$interrupted" == 1 ]]; then RC=130; elif [[ "$recovery_rc" != 0 ]]; then RC=20; fi
  fi
 fi
fi
trap - INT TERM
end_meta "$RC" finished
"$ROOT/collect.sh" "$OUT" || echo '시험 후 지표 수집 오류' > "$OUT/evidence/collection.err"
if [[ ${KUBE_CAPTURE:-1} == 1 && -n ${API_LOG_SELECTOR:-} ]]; then
 SINCE=$(date -u -d "@$START" +%Y-%m-%dT%H:%M:%SZ)
 timeout 20s kubectl --request-timeout=15s -n "$NAMESPACE" logs -l "$API_LOG_SELECTOR" --all-containers=true --since-time="$SINCE" --tail="${API_LOG_TAIL:-5000}" --prefix=true > "$OUT/evidence/api.log" 2> "$OUT/evidence/api-log.err" || true
fi
if [[ ${DB_VERIFY:-0} == 1 && "$MODE" =~ ^(e2e|concurrency)$ ]]; then "$ROOT/verify-db.sh" "$OUT" || true; fi
"$ROOT/report.sh" "$OUT"
echo "완료: $OUT/report.md (종료코드: $RC)"
exit "$RC"
