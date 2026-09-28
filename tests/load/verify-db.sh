#!/usr/bin/env bash
# 기존 패키지의 public.booking / booking_seat / payment 스키마에 대한 읽기 전용 확인.
set -Eeuo pipefail
OUT=${1:?결과 디렉터리를 지정하세요}
RESULT="$OUT/evidence/db-result.json"
BOOKING=$(jq -R 'fromjson? | select(.type=="booking_result")' "$OUT/evidence/k6.log" | jq -s 'last // null')
if [[ "$BOOKING" == null ]]; then
  jq -n '{verdict:"미측정 — 유효한 예약 ID 없음"}' > "$RESULT"
  exit 0
fi
ID=$(jq -r .booking_id <<< "$BOOKING")
SEAT=$(jq -r .seat_id <<< "$BOOKING")
[[ "$ID" =~ ^[1-9][0-9]*$ && "$SEAT" =~ ^[1-9][0-9]*$ ]] || exit 2
WAIT=${DB_WAIT_SECONDS:-120}
[[ "$WAIT" =~ ^[0-9]+$ ]] || exit 2
POD=$(kubectl --request-timeout=15s -n "${DB_NAMESPACE:-data}" get cluster.postgresql.cnpg.io "${DB_CLUSTER:-ticketing-postgresql}" -o jsonpath='{.status.currentPrimary}') || POD=''
if [[ -z "$POD" ]]; then
  jq -n '{verdict:"미측정 — DB Primary 조회 실패"}' > "$RESULT"
  exit 0
fi
SQL="SELECT json_build_object(
'booking_id', $ID,
'seat_link_count', (SELECT count(*) FROM public.booking_seat WHERE seat_id=$SEAT),
'booking_status', (SELECT status FROM public.booking WHERE id=$ID),
'booking_matches_seat', EXISTS(SELECT 1 FROM public.booking_seat WHERE booking_id=$ID AND seat_id=$SEAT),
'payment_statuses', COALESCE((SELECT json_agg(status) FROM public.payment WHERE booking_id=$ID),'[]'::json));"
DEADLINE=$((SECONDS+WAIT))
while :; do
  if printf 'BEGIN READ ONLY;\nSET LOCAL statement_timeout = 5000;\n%s\nCOMMIT;\n' "$SQL" |
    kubectl --request-timeout=15s -n "${DB_NAMESPACE:-data}" exec -i "$POD" -c "${DB_CONTAINER:-postgres}" -- \
      psql -X -qAt -v ON_ERROR_STOP=1 -U "${DB_USER:-postgres}" -d "${DB_NAME:-ticketing}" > "$OUT/evidence/.db.tmp" 2> "$OUT/evidence/db.err" &&
    jq -e 'type=="object" and has("seat_link_count")' "$OUT/evidence/.db.tmp" >/dev/null 2>&1; then
    jq '. + {verdict: (if .seat_link_count==1 and .booking_matches_seat==true and .booking_status=="CONFIRMED" and (.payment_statuses|index("APPROVED"))!=null then "예약 연결 1건·CONFIRMED·결제 APPROVED 확인" else "미충족 또는 처리 대기 — 원본 상태 확인" end)}' "$OUT/evidence/.db.tmp" > "$RESULT"
    if jq -e '.verdict|startswith("예약 연결")' "$RESULT" >/dev/null; then break; fi
  else
    jq -n '{verdict:"미측정 — DB 연결/쿼리/스키마 오류 (db.err 참고)"}' > "$RESULT"
    break
  fi
  ((SECONDS < DEADLINE)) || break
  sleep 3
done
rm -f "$OUT/evidence/.db.tmp"
