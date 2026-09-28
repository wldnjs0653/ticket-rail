#!/usr/bin/env bash

set -Eeuo pipefail

kubectl_bin="${KUBECTL_BIN:-kubectl}"
namespace="${DATA_NAMESPACE:-data}"
bind_address="${LOCAL_BIND_ADDRESS:-127.0.0.1}"

declare -a child_pids=()

cleanup() {
  for pid in "${child_pids[@]:-}"; do
    kill "${pid}" >/dev/null 2>&1 || true
  done
}

forward_forever() {
  local resource="$1"
  local ports="$2"

  while true; do
    "${kubectl_bin}" \
      --namespace "${namespace}" \
      port-forward "${resource}" "${ports}" \
      --address "${bind_address}" || true
    sleep 1
  done
}

trap cleanup EXIT INT TERM

forward_forever pod/ticketing-postgresql-1 5432:5432 &
child_pids+=("$!")

forward_forever pod/redis-0 6379:6379 &
child_pids+=("$!")

forward_forever svc/ticketing-kafka-kafka-bootstrap 9092:9092 &
child_pids+=("$!")

wait
