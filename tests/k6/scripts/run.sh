#!/usr/bin/env bash
set -euo pipefail
package_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
scenario=${1:-}
case "$scenario" in
  smoke|load|queue-load|seat-concurrency|e2e|booking-stream|http-continuity-probe) ;;
  *) printf '%s\n' '사용법: bash scripts/run.sh smoke|load|queue-load|seat-concurrency|e2e|booking-stream|http-continuity-probe' >&2; exit 2 ;;
esac
if [[ $# -ne 1 ]]; then
  printf '%s\n' '인자는 시나리오 이름 하나입니다. 설정은 환경변수로 전달하세요.' >&2
  exit 2
fi
command -v k6 >/dev/null || { printf '%s\n' 'k6 실행 파일을 찾을 수 없습니다.' >&2; exit 127; }
export RUN_ID=${RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$$}
if [[ ! "$RUN_ID" =~ ^[A-Za-z0-9._-]+$ || "$RUN_ID" == '.' || "$RUN_ID" == '..' ]]; then
  printf '%s\n' 'RUN_ID에는 영문·숫자·점·밑줄·하이픈만 사용하세요.' >&2
  exit 2
fi
cd -- "$package_dir"
mkdir -p results
result_dir="results/${RUN_ID}-${scenario}"
mkdir -- "$result_dir" # 기존 회차 결과를 덮어쓰지 않는다.
printf 'run_id=%s\nscenario=%s\nstarted_at_utc=%s\n' "$RUN_ID" "$scenario" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$result_dir/run.txt"
k6_config_args=()
if [[ -n "${K6_HOSTS_JSON:-}" ]]; then
  printf '{"hosts":%s}\n' "$K6_HOSTS_JSON" > "$result_dir/https-hosts.json"
  k6_config_args=(--config "$result_dir/https-hosts.json")
fi
set +e
k6 run "${k6_config_args[@]}" --summary-export "$result_dir/summary.json" --out "json=$result_dir/points.json" \
  --tag "run_id=$RUN_ID" "scenarios/${scenario}.js" 2>&1 | tee "$result_dir/console.log"
pipeline_status=("${PIPESTATUS[@]}")
run_status=${pipeline_status[0]}
if [[ "$run_status" -eq 0 && "${pipeline_status[1]}" -ne 0 ]]; then
  run_status=${pipeline_status[1]}
fi
set -e
printf 'finished_at_utc=%s\nk6_exit_code=%s\nlog_exit_code=%s\nexit_code=%s\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${pipeline_status[0]}" "${pipeline_status[1]}" "$run_status" >> "$result_dir/run.txt"
printf '\n결과: %s/%s\n' "$package_dir" "$result_dir"
exit "$run_status"
