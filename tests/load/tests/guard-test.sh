#!/usr/bin/env bash
# Offline fixture tests: no kubectl, load, network or database access.
set -Eeuo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
set -a; source "$ROOT/guard/defaults.sh"; set +a
sample='{"epoch":200,"mono":200,"nodes":{"kind":"NodeList","items":[{"status":{"conditions":[{"type":"Ready","status":"True"}]}}]},"pods":{"kind":"PodList","items":[{"metadata":{"uid":"a","name":"backend-a","namespace":"app","labels":{"app":"backend"}},"status":{"phase":"Running","conditions":[{"type":"Ready","status":"True"}],"containerStatuses":[{"name":"api","restartCount":0}]}},{"metadata":{"uid":"b","name":"backend-b","namespace":"app","labels":{"app":"backend"}},"status":{"phase":"Running","conditions":[{"type":"Ready","status":"True"}],"containerStatuses":[{"name":"api","restartCount":0}]}}]},"deployment":{"kind":"Deployment","spec":{"template":{"version":1}}},"hpa":{"kind":"HorizontalPodAutoscaler","spec":{"maxReplicas":6,"metrics":[{"type":"Resource","resource":{"name":"cpu","target":{"averageUtilization":50}}}]},"status":{"currentReplicas":2,"currentMetrics":[{"type":"Resource","resource":{"name":"cpu","current":{"averageUtilization":20}}}]}},"up":{"status":"success","data":{"result":[{"metric":{"pod":"backend-a"},"value":[200,"1"]},{"metric":{"pod":"backend-b"},"value":[200,"1"]}]}},"db":{"readable":true,"in_recovery":false},"grafana":{"disabled":true},"host":{"cpu":{"total":1000,"idle":900},"memory":70,"disk":10737418240}}'
eval_rule() { local http=${3:-}; [[ -n "$http" ]] || http="{}"; jq -cn --argjson s "$1" --argjson prev "$2" --argjson baseline "$base" --argjson http "$http" -f "$ROOT/guard/evaluate.jq"; }
base='{}'
base=$(eval_rule "$sample" '{}')
jq -e '.preflight_ok and (.reasons|length)==0' <<< "$base" >/dev/null
assert_reason() {
 local changed=$1 reason=$2 hold=${3:-0} http=${4:-'{}'}
 local s first second
 s=$(jq -c "$changed" <<< "$sample")
 first=$(eval_rule "$s" "$base" "$http")
 if ((hold>0)); then
   jq -e --arg r "$reason" '(.reasons|index($r))==null' <<< "$first" >/dev/null
   s=$(jq -c --argjson seconds "$hold" '.mono += $seconds' <<< "$s")
 fi
 second=$(eval_rule "$s" "$first" "$http")
 # Immediate restart is a delta event: it is present in the first observation only.
 if ((hold==0)); then second=$first; fi
 jq -e --arg r "$reason" '(.reasons|index($r))!=null' <<< "$second" >/dev/null || { echo "FAIL $reason: $second"; exit 1; }
 printf 'PASS %s\n' "$reason"
}
assert_reason '.nodes.items[0].status.conditions[0].status="False"' 'Node NotReady'
assert_reason '.pods.items[0].status.conditions[0].status="False"' 'Backend Ready 미달 지속' 30
assert_reason '.pods.items[0].status.containerStatuses[0].restartCount=1' '새 컨테이너 재시작'
assert_reason '.pods.items[0].status.containerStatuses[0].state.terminated.reason="OOMKilled"' 'OOMKilled'
assert_reason '.deployment.spec.template.version=2' 'Backend Deployment template 변경'
assert_reason '.up.data.result=[]' '필수 관측 경로 장애 지속' 60
assert_reason '.db.in_recovery=true' 'PostgreSQL Primary 읽기 접근 실패'
assert_reason '.host.memory=9' 'k6 실행 서버 메모리 여유 부족'
assert_reason '.host.disk=1024' '결과 디스크 여유 부족'
assert_reason '.hpa.status.currentReplicas=6 | .hpa.status.currentMetrics[0].resource.current.averageUtilization=80' 'HPA 최대 Replica에서 CPU 포화 지속' 60
assert_reason '.grafana={query_error:true}' 'Grafana Health 장애 지속' 60
assert_reason '.' '최근 1분 HTTP 실패율 기준 초과 지속' 60 '{"started":100,"b":{"200":{"t":200,"n":100,"f":1}}}'
assert_reason '.' 'k6 dropped_iterations 발생' 0 '{"dropped":1}'
assert_reason '.' 'k6 expected_response 태그 누락' 0 '{"errors":1}'
# CPU uses successive /proc deltas, not load average.
s=$(jq '.host.cpu.total=2000 | .host.cpu.idle=900' <<< "$sample")
p=$(eval_rule "$s" "$base")
s=$(jq '.mono+=60 | .host.cpu.total=3000' <<< "$s")
p=$(eval_rule "$s" "$p")
jq -e '.reasons|index("k6 실행 서버 CPU 포화 지속")!=null' <<< "$p" >/dev/null
printf 'PASS k6 실행 서버 CPU 포화 지속\n'
# Recovery must reset a persistence timer.
p=$(eval_rule "$(jq '.up.data.result=[]' <<< "$sample")" "$base")
p=$(eval_rule "$(jq '.mono+=30' <<< "$sample")" "$p")
p=$(eval_rule "$(jq '.mono+=60 | .up.data.result=[]' <<< "$sample")" "$p")
jq -e '.reasons|index("필수 관측 경로 장애 지속")==null' <<< "$p" >/dev/null
printf 'PASS 회복 시 지속시간 초기화\n'
