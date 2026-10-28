#!/usr/bin/env bash
set -uo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

kubeconfig="${KUBECONFIG_PATH:-/root/.kube/ticketrail-onprem.conf}"
expected_server="${EXPECTED_SERVER:-https://10.1.93.65:6443}"
namespace="${DATA_NAMESPACE:-data}"
cluster="${POSTGRESQL_CLUSTER:-ticketing-postgresql}"
timeout_seconds="${FAILOVER_TIMEOUT_SECONDS:-600}"
warmup_seconds="${K6_WARMUP_SECONDS:-15}"
k6_duration="${FAILOVER_DURATION:-5m}"

load_lock="/tmp/ticketrail-onprem-loadtest.lock"
disruptive_lock="/tmp/ticketrail-onprem-disruptive.lock"

results_root="${RESULTS_ROOT:-/root/ticketing-ansible/artifacts/postgresql-failover-tests}"
test_id="${TEST_ID:-postgresql-graceful-$(date -u +%Y%m%d-%H%M%S)}"

ansible_base="/root/ticketing-ansible/failure-tests"
ansible_runner="$ansible_base/scripts/60_postgresql_failover.sh"
inventory="$ansible_base/inventory.ini"
k6_probe="$script_dir/k6-postgresql-read.sh"
k6_root="${K6_PACKAGE_ROOT:-/root/ticketing-k6-final}"

ansible_results_root="$results_root/ansible"
orchestration_dir="$results_root/orchestration/$test_id"
k6_test_id="${test_id}-api"
k6_result_dir="$k6_root/results/${k6_test_id}-load"

lock_owned=0
k6_pid=""

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [[ -n "$k6_pid" ]] && kill -0 "$k6_pid" 2>/dev/null; then
    kill -TERM -- "-$k6_pid" 2>/dev/null ||
      kill -TERM "$k6_pid" 2>/dev/null ||
      true
    wait "$k6_pid" 2>/dev/null || true
  fi

  if [[ "$lock_owned" == "1" ]]; then
    rm -f -- "$disruptive_lock"
  fi
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

[[ "${CONFIRM_DISRUPTIVE_TESTS:-NO}" == "YES" ]] ||
  die "CONFIRM_DISRUPTIVE_TESTS=YES가 필요합니다."

[[ "${CONFIRM_REDIS_IDLE:-NO}" == "YES" ]] ||
  die "Redis 작업 종료 확인용 CONFIRM_REDIS_IDLE=YES가 필요합니다."

[[ "$test_id" =~ ^[A-Za-z0-9._-]+$ ]] ||
  die "TEST_ID 형식이 올바르지 않습니다."

for command_name in kubectl jq curl k6 ansible-playbook setsid; do
  command -v "$command_name" >/dev/null ||
    die "필수 명령을 찾을 수 없습니다: $command_name"
done

[[ -f "$kubeconfig" ]] ||
  die "온프레미스 kubeconfig가 없습니다: $kubeconfig"

[[ -x "$ansible_runner" ]] ||
  die "Ansible 실행기가 없습니다: $ansible_runner"

[[ -f "$inventory" ]] ||
  die "Ansible inventory가 없습니다: $inventory"

[[ -x "$k6_probe" ]] ||
  die "K6 탐침이 없습니다: $k6_probe"

[[ ! -e "$load_lock" ]] || {
  cat "$load_lock" >&2 || true
  die "다른 온프레미스 부하시험이 진행 중입니다."
}

[[ ! -e "$disruptive_lock" ]] || {
  cat "$disruptive_lock" >&2 || true
  die "다른 장애시험이 진행 중입니다."
}

if (
  umask 077
  set -o noclobber
  printf \
    'OWNER=postgresql-graceful-failover\nTEST_ID=%s\nSTARTED_AT=%s\n' \
    "$test_id" \
    "$(date -u +%FT%TZ)" \
    > "$disruptive_lock"
) 2>/dev/null
then
  lock_owned=1
else
  die "장애시험 잠금을 생성하지 못했습니다."
fi

server=$(
  kubectl --kubeconfig "$kubeconfig" \
    config view --minify \
    -o jsonpath='{.clusters[0].cluster.server}'
)

[[ "$server" == "$expected_server" ]] ||
  die "잘못된 Kubernetes API: expected=$expected_server actual=$server"

cluster_json=$(
  kubectl --kubeconfig "$kubeconfig" \
    -n "$namespace" get cluster "$cluster" -o json
) || die "PostgreSQL Cluster를 조회하지 못했습니다."

phase=$(jq -r '.status.phase // ""' <<<"$cluster_json")
instances=$(jq -r '.spec.instances // 0' <<<"$cluster_json")
ready=$(jq -r '.status.readyInstances // 0' <<<"$cluster_json")
primary=$(jq -r '.status.currentPrimary // ""' <<<"$cluster_json")

[[ "$phase" == "Cluster in healthy state" ]] ||
  die "PostgreSQL Cluster가 정상 상태가 아닙니다: $phase"

[[ "$instances" -ge 3 && "$ready" == "$instances" ]] ||
  die "PostgreSQL 인스턴스가 모두 Ready가 아닙니다: $ready/$instances"

[[ -n "$primary" ]] ||
  die "현재 Primary를 확인하지 못했습니다."

api_code=$(
  curl --silent --show-error --insecure \
    --connect-timeout 3 --max-time 10 \
    --output /dev/null \
    --write-out '%{http_code}' \
    https://api.nammer.store/events
)

[[ "$api_code" == "200" ]] ||
  die "/events 사전 점검 실패: HTTP=$api_code"

[[ ! -e "$orchestration_dir" ]] ||
  die "이미 존재하는 시험 결과입니다: $orchestration_dir"

[[ ! -e "$ansible_results_root/$test_id" ]] ||
  die "이미 존재하는 Ansible 결과입니다: $test_id"

[[ ! -e "$k6_result_dir" ]] ||
  die "이미 존재하는 K6 결과입니다: $k6_result_dir"

mkdir -p "$orchestration_dir" "$ansible_results_root"

{
  echo "TEST_ID=$test_id"
  echo "KUBERNETES_SERVER=$server"
  echo "PRIMARY_BEFORE=$primary"
  echo "INSTANCES=$instances"
  echo "K6_DURATION=$k6_duration"
  echo "STARTED_AT=$(date -u +%FT%TZ)"
} > "$orchestration_dir/metadata.env"

kubectl --kubeconfig "$kubeconfig" \
  -n "$namespace" get cluster "$cluster" -o yaml \
  > "$orchestration_dir/cluster-before.yaml"

kubectl --kubeconfig "$kubeconfig" \
  -n "$namespace" get pods \
  -l "cnpg.io/cluster=$cluster" -o wide \
  > "$orchestration_dir/pods-before.txt"

echo "===== K6 POSTGRESQL PROBE START ====="

setsid env \
  TEST_ID="$k6_test_id" \
  FAILOVER_DURATION="$k6_duration" \
  K6_PACKAGE_ROOT="$k6_root" \
  "$k6_probe" \
  > "$orchestration_dir/k6-launch.log" 2>&1 &

k6_pid=$!
sleep "$warmup_seconds"

kill -0 "$k6_pid" 2>/dev/null ||
  die "K6 탐침이 장애 주입 전에 종료됐습니다."

echo "===== GRACEFUL PRIMARY POD DELETION TEST ====="

test_started_ms=$(date +%s%3N)

CONFIRM_DISRUPTIVE_TESTS=YES \
TEST_ID="$test_id" \
"$ansible_runner" \
  -i "$inventory" \
  -e "kubeconfig_path=$kubeconfig" \
  -e "data_failover_timeout_seconds=$timeout_seconds" \
  -e "results_root=$ansible_results_root"

ansible_rc=$?
test_finished_ms=$(date +%s%3N)

wait "$k6_pid"
k6_rc=$?
k6_pid=""

if [[ -d "$k6_result_dir" ]]; then
  cp -a "$k6_result_dir" "$orchestration_dir/k6"
fi

kubectl --kubeconfig "$kubeconfig" \
  -n "$namespace" get cluster "$cluster" -o yaml \
  > "$orchestration_dir/cluster-after.yaml" || true

kubectl --kubeconfig "$kubeconfig" \
  -n "$namespace" get pods \
  -l "cnpg.io/cluster=$cluster" -o wide \
  > "$orchestration_dir/pods-after.txt" || true

current_health=$(
  curl --silent --show-error --insecure \
    --connect-timeout 3 --max-time 10 \
    --output /dev/null \
    --write-out '%{http_code}' \
    https://api.nammer.store/health/ready || true
)

summary_file="$orchestration_dir/k6/summary.json"

if [[ -f "$summary_file" ]]; then
  jq '{
    http_reqs:
      (.metrics.http_reqs.count // .metrics.http_reqs.values.count // 0),
    http_failure_rate:
      (.metrics.http_req_failed.value // .metrics.http_req_failed.values.rate // 0),
    dropped_iterations:
      (.metrics.dropped_iterations.count // .metrics.dropped_iterations.values.count // 0),
    http_req_duration_p95_ms:
      (.metrics.http_req_duration["p(95)"] // .metrics.http_req_duration.values["p(95)"] // 0),
    http_req_duration_max_ms:
      (.metrics.http_req_duration.max // .metrics.http_req_duration.values.max // 0)
  }' "$summary_file" \
    > "$orchestration_dir/http-summary.json"
fi

{
  echo "TEST_ID=$test_id"
  echo "ANSIBLE_EXIT_CODE=$ansible_rc"
  echo "K6_EXIT_CODE=$k6_rc"
  echo "TEST_ELAPSED_MS=$((test_finished_ms - test_started_ms))"
  echo "FINAL_HEALTH_HTTP=$current_health"

  if [[ "$ansible_rc" == "0" &&
        "$k6_rc" == "0" &&
        "$current_health" == "200" ]]; then
    echo "STATUS=COMPLETE"
  else
    echo "STATUS=FAILED"
  fi
} > "$orchestration_dir/final-status.env"

echo
echo "===== FINAL STATUS ====="
cat "$orchestration_dir/final-status.env"

if [[ -f "$orchestration_dir/http-summary.json" ]]; then
  echo
  echo "===== HTTP SUMMARY ====="
  cat "$orchestration_dir/http-summary.json"
fi

echo
echo "RESULT_DIR=$orchestration_dir"

if [[ "$ansible_rc" != "0" ||
      "$k6_rc" != "0" ||
      "$current_health" != "200" ]]; then
  exit 1
fi
