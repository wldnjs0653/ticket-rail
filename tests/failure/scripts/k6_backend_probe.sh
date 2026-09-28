#!/usr/bin/env bash
set -euo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
k6_root="${K6_PACKAGE_ROOT:-${script_dir}/../../k6}"
test_id="${TEST_ID:-N-01-$(date -u +%Y%m%d-%H%M%S)}"
base_url="${BASE_URL:-https://api.ticketing.local}"
health_path="${HEALTH_PATH:-/healthz}"

command -v k6 >/dev/null || {
  printf '%s\n' 'k6 실행 파일을 찾을 수 없습니다.' >&2
  exit 127
}
[[ -f "$k6_root/scenarios/http-continuity-probe.js" ]] || {
  printf 'k6 패키지를 찾을 수 없습니다: %s\n' "$k6_root" >&2
  exit 1
}

cd -- "$k6_root"
RUN_ID="$test_id" \
TEST_ID="$test_id" \
TARGET_URL="${base_url}${health_path}" \
RATE="${RATE:-2}" \
DURATION="${DURATION:-5m}" \
REQUEST_TIMEOUT="${REQUEST_TIMEOUT:-2s}" \
REQUEST_HEADERS_JSON="${REQUEST_HEADERS_JSON:-{}}" \
K6_INSECURE_SKIP_TLS_VERIFY="${K6_INSECURE_SKIP_TLS_VERIFY:-true}" \
K6_HOSTS_JSON="${K6_HOSTS_JSON:-{\"api.ticketing.local\":\"10.1.93.69\"}}" \
exec bash scripts/run.sh http-continuity-probe
