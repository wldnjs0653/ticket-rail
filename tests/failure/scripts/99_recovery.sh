#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd -- "$project_dir"
cleanup_args=()
if [[ -n "${TEST_ID:-}" ]]; then
  cleanup_args=(-e "cleanup_test_id=$TEST_ID")
fi
exec ansible-playbook playbooks/99_recovery.yml "$@" "${cleanup_args[@]}"
