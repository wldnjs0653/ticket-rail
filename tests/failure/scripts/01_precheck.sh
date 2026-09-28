#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd -- "$project_dir"

ansible all -m ansible.builtin.ping
exec ansible-playbook playbooks/precheck_only.yml
