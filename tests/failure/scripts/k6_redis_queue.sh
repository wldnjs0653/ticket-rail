#!/usr/bin/env bash
set -euo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
k6_root="${K6_PACKAGE_ROOT:-${script_dir}/../../k6}"
: "${EVENT_ID:?EVENT_ID is required}"
test_id="${TEST_ID:-D-01-$(date -u +%Y%m%d-%H%M%S)}"

command -v k6 >/dev/null || {
  printf '%s\n' 'k6 실행 파일을 찾을 수 없습니다.' >&2
  exit 127
}
[[ -f "$k6_root/scenarios/queue-load.js" ]] || {
  printf 'k6 패키지를 찾을 수 없습니다: %s\n' "$k6_root" >&2
  exit 1
}

cd -- "$k6_root"
RUN_ID="$test_id" \
BASE_URL="${BASE_URL:-https://api.ticketing.local}" \
TEST_MODE=failover \
EVENT_ID="$EVENT_ID" \
FAILOVER_RATE="${FAILOVER_RATE:-1}" \
FAILOVER_DURATION="${FAILOVER_DURATION:-10m}" \
REQUEST_TIMEOUT="${REQUEST_TIMEOUT:-2s}" \
QUEUE_MAX_WAIT_SECONDS="${QUEUE_MAX_WAIT_SECONDS:-600}" \
PRE_ALLOCATED_VUS="${PRE_ALLOCATED_VUS:-100}" \
MAX_VUS="${MAX_VUS:-200}" \
K6_INSECURE_SKIP_TLS_VERIFY="${K6_INSECURE_SKIP_TLS_VERIFY:-true}" \
K6_HOSTS_JSON="${K6_HOSTS_JSON:-{\"api.ticketing.local\":\"10.1.93.69\"}}" \
exec bash scripts/run.sh queue-load
