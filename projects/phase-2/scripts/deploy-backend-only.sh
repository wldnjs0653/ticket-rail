#!/usr/bin/env bash
set -euo pipefail

: "${KUBECONFIG:?KUBECONFIG is required}"
: "${BACKEND_IMAGE:?BACKEND_IMAGE is required}"
[[ "$BACKEND_IMAGE" =~ ^ghcr\.io/jisoo9123/ticketing-api:sha-[0-9a-f]{12}$ ]]

DEADLINE=$(( SECONDS + 900 ))
while [[ -e /tmp/ticketrail-onprem-loadtest.lock || -e /tmp/ticketrail-onprem-disruptive.lock ]]; do
  echo 'WAITING: existing test/deployment must finish before updating the backend.'
  for lock in /tmp/ticketrail-onprem-loadtest.lock /tmp/ticketrail-onprem-disruptive.lock; do
    if [[ -e "$lock" ]]; then
      stat --format='%y %n' "$lock"
      sed -n '1p' "$lock"
    fi
  done
  ps -eo pid,etime,comm | awk '$3 == "k6" { print "ACTIVE_TEST:", $0 }'
  if (( SECONDS >= DEADLINE )); then
    echo 'ERROR: Lock remained for 15 minutes; deployment was not changed.'
    exit 1
  fi
  sleep 20
done

k() { kubectl --kubeconfig "$KUBECONFIG" --namespace app "$@"; }
PROXY='/api/v1/namespaces/app/services/http:backend:http/proxy'
SNAPSHOT=$(k get deployment backend -o json)
CONTAINERS=$(jq '[.spec.template.spec.containers[] | select(.name == "backend")] | length' <<< "$SNAPSHOT")
[[ "$CONTAINERS" == 1 ]]
OLD_IMAGE=$(jq -r '.spec.template.spec.containers[] | select(.name == "backend") | .image' <<< "$SNAPSHOT")
VERSION=$(jq -r '.metadata.resourceVersion' <<< "$SNAPSHOT")
SKIP=$(jq -r '.spec.template.spec.containers[] | select(.name == "backend") | .env[]? | select(.name == "SKIP_KAFKA_CONSUMERS") | .value' <<< "$SNAPSHOT")
[[ "$SKIP" == true ]]
echo "PREVIOUS_BACKEND_IMAGE=$OLD_IMAGE"
echo "TARGET_BACKEND_IMAGE=$BACKEND_IMAGE"

PATCH=$(jq -nc --arg image "$BACKEND_IMAGE" --arg version "$VERSION" \
  '{metadata:{resourceVersion:$version},spec:{template:{spec:{containers:[{name:"backend",image:$image}]}}}}')
k patch deployment backend --type=strategic -p "$PATCH"

rollback() {
  local current
  current=$(k get deployment backend -o jsonpath='{.spec.template.spec.containers[?(@.name=="backend")].image}')
  if [[ "$current" == "$BACKEND_IMAGE" ]]; then
    echo "ROLLBACK_BACKEND_IMAGE=$OLD_IMAGE"
    k set image deployment/backend "backend=$OLD_IMAGE"
    k rollout status deployment/backend --timeout=180s
  else
    echo 'Rollback skipped because another deployment changed the image.'
  fi
}

verify() {
  k rollout status deployment/backend --timeout=180s || return 1
  local readiness ui response
  readiness=$(k get --raw "$PROXY/health/ready") || return 1
  jq -e '.status == "ready"' <<< "$readiness" >/dev/null || return 1
  ui=$(k get --raw "$PROXY/ticketing.html") || return 1
  grep -q 'id="tripDate"' <<< "$ui" || return 1
  grep -q 'onclick="openDepartureCalendar()"' <<< "$ui" || return 1
  if grep -q 'id="resultsTripDate"' <<< "$ui"; then return 1; fi
  grep -q 'id="queueWaitingModal"' <<< "$ui" || return 1
  grep -q 'id="paymentCheckBtn"' <<< "$ui" || return 1
  grep -q 'id="ticketViewBtn"' <<< "$ui" || return 1
  grep -q 'startPaymentStatusPolling' <<< "$ui" || return 1
  grep -q 'startNotificationStatusPolling' <<< "$ui" || return 1
  grep -q 'onConfirmed: showPaymentToast' <<< "$ui" || return 1
  if grep -qE '다시 결제하지 않아도 됩니다\.|결제와 예매가 모두 확정되었습니다\.|완료되면 예매 완료 화면으로 자동 이동합니다\.' <<< "$ui"; then return 1; fi
  local payment_ui
  payment_ui=$(k get --raw "$PROXY/payment-status.js") || return 1
  grep -q 'classifyPayment' <<< "$payment_ui" || return 1
  grep -q 'createNotificationTracker' <<< "$payment_ui" || return 1
  grep -q "status === 'APPROVED'" <<< "$payment_ui" || return 1
  response=$(k get --raw "$PROXY/events?date=2026-10-17") || return 1
  jq -e '.service_date == "2026-10-17" and (.events | length) == 44' <<< "$response" >/dev/null || return 1
  echo "DAILY_CATALOG_EVENTS=$(jq '.events | length' <<< "$response")"
  echo 'BACKEND_ONLY_DEPLOYMENT=PASS'
  echo 'PAYMENT_DELAY_UI_DEPLOYMENT=PASS'
  echo 'NOTIFICATION_TOAST_DEPLOYMENT=PASS'
}

if ! verify; then
  rollback
  exit 1
fi
