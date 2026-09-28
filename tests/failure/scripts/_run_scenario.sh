#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
playbook="${1:?playbook name is required}"
scenario="${2:?scenario name is required}"
shift
shift

if [[ "${CONFIRM_DISRUPTIVE_TESTS:-NO}" != "YES" ]]; then
  printf '%s\n' '실제 장애 시험입니다.' >&2
  printf '%s\n' '실행하려면 CONFIRM_DISRUPTIVE_TESTS=YES를 지정하십시오.' >&2
  exit 2
fi

cd -- "$project_dir"
test_id="${TEST_ID:-${scenario}-$(date -u +%Y%m%d-%H%M%S)}"
if [[ ! "$test_id" =~ ^[A-Za-z0-9._-]+$ || "$test_id" == '.' || "$test_id" == '..' ]]; then
  printf '%s\n' 'TEST_ID에는 영문·숫자·점·밑줄·하이픈만 사용할 수 있습니다.' >&2
  exit 2
fi
exec ansible-playbook "playbooks/$playbook" \
  "$@" \
  -e confirm_disruptive_tests=YES \
  -e "test_scenario=$scenario" \
  -e "requested_test_id=$test_id"
