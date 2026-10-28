#!/usr/bin/env bash
set -euo pipefail

k6_root="${K6_PACKAGE_ROOT:-/root/ticketing-k6-final}"
: "${TARGET_PATH:=/events}"
test_id="${TEST_ID:-D-02-$(date -u +%Y%m%d-%H%M%S)}"

expected_api_ip="${EXPECTED_API_IP:-10.1.93.69}"
resolved_api_ip=$(
  getent ahostsv4 api.nammer.store |
  awk 'NR == 1 { first = $1 } END { print first }'
)

if [[ "$resolved_api_ip" != "$expected_api_ip" ]]; then
  printf 'api.nammer.store 대상 오류: expected=%s actual=%s\n' \
    "$expected_api_ip" "$resolved_api_ip" >&2
  exit 1
fi

command -v k6 >/dev/null || {
  printf '%s\n' 'k6 실행 파일을 찾을 수 없습니다.' >&2
  exit 127
}
[[ -f "$k6_root/scenarios/load.js" ]] || {
  printf 'k6 패키지를 찾을 수 없습니다: %s\n' "$k6_root" >&2
  exit 1
}

cd -- "$k6_root"
RUN_ID="$test_id" \
BASE_URL="${BASE_URL:-https://api.nammer.store}" \
TEST_MODE=failover \
TARGET_PATH="$TARGET_PATH" \
EXPECTED_STATUS_CODES="${EXPECTED_STATUS_CODES:-200}" \
FAILOVER_RATE="${FAILOVER_RATE:-2}" \
FAILOVER_DURATION="${FAILOVER_DURATION:-5m}" \
REQUEST_TIMEOUT="${REQUEST_TIMEOUT:-2s}" \
PRE_ALLOCATED_VUS="${PRE_ALLOCATED_VUS:-10}" \
MAX_VUS="${MAX_VUS:-30}" \
exec bash scripts/run.sh load
