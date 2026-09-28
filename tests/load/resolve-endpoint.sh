#!/usr/bin/env bash
set -Eeuo pipefail
if [[ ${BASE_URL:-auto} == auto || -z ${BASE_URL:-} ]]; then
  candidates=$(timeout 15s kubectl --request-timeout=10s -n "${NAMESPACE:-app}" get ingress -o json | jq -c --arg backend "${BACKEND_NAME:-backend}" '
    [.items[] | .spec as $spec | .spec.rules[]? |
      select(any(.http.paths[]?; .backend.service.name==$backend)) |
      .host as $host | select(any($spec.tls[]?.hosts[]?; . as $pattern | .==$host or (startswith("*.") and ($host|endswith($pattern[1:]))))) | $host] | unique')
  [[ $(jq length <<< "$candidates") == 1 ]] || { echo 'Ingress에서 API HTTPS 도메인을 하나로 특정하지 못했습니다. config.env에 BASE_URL=https://실제도메인을 지정하세요.' >&2; exit 2; }
  BASE_URL="https://$(jq -r '.[0]' <<< "$candidates")"
fi
BASE_URL=${BASE_URL%/}
if [[ "$BASE_URL" =~ ^http://(127\.0\.0\.1|localhost)(:[0-9]+)?$ && ${LOCAL_MOCK:-0} == 1 ]]; then printf '%s\n' "$BASE_URL"; exit; fi
[[ "$BASE_URL" =~ ^https://([a-zA-Z0-9.-]+)(:[0-9]+)?$ ]] || { echo 'BASE_URL은 실제 도메인의 HTTPS 주소여야 합니다.' >&2; exit 2; }
host=${BASH_REMATCH[1]}
[[ "$host" != *.local && "$host" != *YOUR* && "$host" != *example.com ]] || { echo '기존 .local 주소나 예시 주소를 실제 공인 인증서 도메인으로 바꾸세요.' >&2; exit 2; }
getent ahosts "$host" >/dev/null || { echo "k6 실행 호스트에서 $host DNS 해석 실패. 내부 DNS 설정을 확인하세요." >&2; exit 2; }
# No --insecure, no --resolve, no forced Host header: verify the real user path.
status=$(curl -sS --connect-timeout 5 --max-time 15 -o /dev/null -w '%{http_code}' "$BASE_URL${HEALTH_PATH:-/health/live}") || {
  echo 'HTTPS 접속/공인 인증서 검증 실패. DNS·Ingress 인증서 체인·만료·시각 및 예전 SSL_CERT_FILE 설정을 확인하세요.' >&2; exit 2;
}
[[ $status == 200 ]] || { echo "Health 응답 HTTP $status: 경로와 Ingress를 확인하세요." >&2; exit 2; }
printf '%s\n' "$BASE_URL"
