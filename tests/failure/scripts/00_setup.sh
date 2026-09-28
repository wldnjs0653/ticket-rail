#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd -- "$project_dir"

for command_name in bash ansible ansible-playbook kubectl python3 curl date timedatectl; do
  command -v "$command_name" >/dev/null || {
    printf '필수 명령이 없습니다: %s\n' "$command_name" >&2
    exit 1
  }
done

ansible-playbook playbooks/00_setup.yml

for playbook in \
  precheck_only.yml \
  run_all.yml \
  01_pod_autohealing.yml \
  02_worker_failure.yml \
  03_master_failure.yml \
  04_lb_failure.yml \
  05_redis_failover.yml \
  06_postgresql_failover.yml \
  07_kafka_failure.yml \
  99_recovery.yml \
  recover.yml; do
  ansible-playbook --syntax-check "playbooks/$playbook" \
    -e confirm_disruptive_tests=YES >/dev/null
done

printf '%s\n' '기본 세팅과 Playbook 문법 확인 완료'
printf '%s\n' '다음 명령: scripts/01_precheck.sh'
