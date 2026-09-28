#!/usr/bin/env bash
set -euo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
k6_root="${K6_PACKAGE_ROOT:-${script_dir}/../../k6}"
: "${TARGET_PATH:?TARGET_PATH is required; use the confirmed PostgreSQL-backed API path}"
test_id="${TEST_ID:-D-02-$(date -u +%Y%m%d-%H%M%S)}"

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
BASE_URL="${BASE_URL:-https://api.ticketing.local}" \
TEST_MODE=failover \
TARGET_PATH="$TARGET_PATH" \
EXPECTED_STATUS_CODES="${EXPECTED_STATUS_CODES:-200}" \
FAILOVER_RATE="${FAILOVER_RATE:-2}" \
FAILOVER_DURATION="${FAILOVER_DURATION:-5m}" \
REQUEST_TIMEOUT="${REQUEST_TIMEOUT:-2s}" \
PRE_ALLOCATED_VUS="${PRE_ALLOCATED_VUS:-10}" \
MAX_VUS="${MAX_VUS:-30}" \
K6_INSECURE_SKIP_TLS_VERIFY="${K6_INSECURE_SKIP_TLS_VERIFY:-true}" \
K6_HOSTS_JSON="${K6_HOSTS_JSON:-{\"api.ticketing.local\":\"10.1.93.69\"}}" \
exec bash scripts/run.sh load
