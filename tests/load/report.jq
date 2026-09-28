def fmt: if . == null then "미측정" elif type == "number" then ((.*100|round)/100|tostring) else tostring end;
def val($name;$key): $k6[0].metrics[$name].values[$key];
def num: try tonumber catch null;
def points: [.response.data.result[]? | (.values // [.value])[]? | {t:.[0], v:(.[1]|num)} | select(.v != null)] | sort_by(.t);
def obsrow:
  . as $o | points as $p |
  "| \($o.label) | " +
  (if .state == "unconfigured" then "미설정"
   elif .state == "error" then "수집 오류"
   elif ($p|length)==0 then "미측정"
   elif .type == "instant" then
      ([.response.data.result[]? | ((.metric // {})|to_entries|map(.key+"="+.value)|join(",")) as $labels |
        "\(if $labels=="" then "전체" else $labels end): \(.["value"][1]|num|fmt)"]|join("; "))
   else "처음 \($p[0].v|fmt) / 최대 \($p|map(.v)|max|fmt) / 마지막 \($p[-1].v|fmt)" end) +
  " | \(.unit) |";
"# 부하시험 결과",
"",
"- 시험: \($run[0].mode) / \($run[0].run_id)",
"- 실행: \(if $run[0].exit_code==0 then "완료" else "실패 또는 중단 (종료코드 \($run[0].exit_code))" end). 이 표시는 성능 목표 달성 판정이 아닙니다.",
"- 시간: \($run[0].start|todateiso8601) ~ \($run[0].end|todateiso8601)",
"",
"## 1. k6에서 보낸 요청과 받은 결과",
"",
"| 항목 | 결과 |",
"|---|---:|",
"| 요청 시도 | \(val("client_requests";"count")|fmt) |",
"| 응답·네트워크 결과 수신 | \(val("client_responses";"count")|fmt) |",
"| 2xx | \(val("client_2xx";"count")|fmt) |",
"| 409 / 429 / 나머지 4xx | \(val("client_409";"count")|fmt) / \(val("client_429";"count")|fmt) / \(val("client_other_4xx";"count")|fmt) |",
"| 5xx / 네트워크 실패 / 기타 HTTP | \(val("client_5xx";"count")|fmt) / \(val("client_network";"count")|fmt) / \(val("client_other_http";"count")|fmt) |",
"| HTTP 2xx 비율 | \(if (val("client_responses";"count") // 0)>0 then (100*val("client_2xx";"count")/val("client_responses";"count")|fmt)+"%" else "미측정" end) |",
"| k6 HTTP RPS | \(val("http_reqs";"rate")|fmt) |",
"| 지연 p50 / p95 / p99 (ms) | \(val("client_duration_ms";"med")|fmt) / \(val("client_duration_ms";"p(95)")|fmt) / \(val("client_duration_ms";"p(99)")|fmt) |",
"",
"2xx는 HTTP 응답 분류이며 예약 완료를 뜻하지 않습니다. 요청 시도에는 중단 직전 요청이 포함될 수 있습니다. RPS는 k6 집계 기준이고 동시성 시험에는 입장 준비 요청도 포함됩니다. 표본은 evidence/k6.log의 request_sample입니다.",
(if $run[0].mode=="e2e" then
  "\nE2E HTTP 결과: Hold \(val("e2e_hold_successes";"count")|fmt)건 / 예약 \(val("e2e_booking_successes";"count")|fmt)건. DB·결제 결과와 구분합니다."
 elif $run[0].mode=="concurrency" then
  "\n동일 좌석 HTTP 결과: Hold 성공 \(val("hold_successes";"count")|fmt)건 / 충돌 \(val("hold_conflicts";"count")|fmt)건 / 예약 성공 \(val("booking_successes";"count")|fmt)건. DB 최종 1건 여부는 DB 확인 결과를 봅니다."
 else empty end),
(if $run[0].mode=="load" then
  "\n| 부하 구간 | 요청 시도 | p95 (ms) |\n|---|---:|---:|",
  (["warmup_ramp","warmup_hold","normal_ramp","normal_hold","peak_ramp","peak_hold","spike_ramp","spike_hold","recovery_ramp","recovery_hold","stop","finished"][] as $phase |
    "| \($phase) | \(val("client_requests{phase:\($phase)}";"count")|fmt) | \(if (val("client_requests{phase:\($phase)}";"count") // 0)>0 then (val("client_duration_ms{phase:\($phase)}";"p(95)")|fmt) else "미측정" end) |")
  else empty end),
"",
"## 2. 큐가 쌓이고 줄었는지",
"",
"| 서버 관측 | 결과 | 단위 |",
"|---|---|---|",
($obs[] | select(.section=="queue") | obsrow),
"",
"k6 대기 응답: \(val("queue_waiting_responses";"count")|fmt)회 / 입장: \(val("queue_admissions";"count")|fmt)건 / 입장 대기 p95: \(if (val("queue_admissions";"count") // 0)>0 then (val("queue_wait_duration_ms";"p(95)")|fmt) else "미측정" end)ms / 입장 실패: \(val("queue_admission_failures";"count")|fmt)건.",
(if val("queue_read_sessions";"count")!=null then
  "입장 후 조회 세션 시작 / 완료: \(val("queue_read_sessions";"count")|fmt) / \(val("queue_read_sessions_completed";"count")|fmt). 차이가 있으면 조회 세션이 완료되지 않은 것입니다."
 else empty end),
"새 사용자 실행 누락(dropped_iterations): \(val("dropped_iterations";"count")|fmt)건. 누락이 있으면 계획 유입량을 달성하지 못한 것입니다.",
"대기 응답 횟수는 큐 인원수가 아닙니다. 서버 depth 시계열로 적체·해소를 확인합니다. 표본 간 피크는 놓칠 수 있으며, depth가 없으면 적체 증명은 미측정입니다.",
"",
"## 3. API 내부에서 받은·처리한 결과",
"",
"| 서버 관측 | 결과 | 단위 |",
"|---|---|---|",
($obs[] | select(.section=="api") | obsrow),
"",
"서버 HTTP Counter는 응답 완료 시점의 증가량 추정치입니다. 요청 접수 순간의 정확한 건수나 예약·결제 완료 건수와는 다릅니다. 같은 서비스의 다른 트래픽도 포함될 수 있어 k6 건수와 일치한다고 판정하지 않습니다.",
"",
"## 4. 5차 기획서의 나머지 요구 지표",
"",
"| 관측 | 결과 | 단위 |",
"|---|---|---|",
($obs[] | select(.section=="plan") | obsrow),
"",
"시계열의 여러 시리즈 값은 합산하지 않고 전체 표본 중 최대값을 표시합니다. 처음·마지막은 해당 시각의 한 시리즈 값일 수 있으므로 상세 비교는 원본의 라벨과 시계열을 봅니다.",
"",
"5차 기획서의 좌석 정확성·Hold TTL·DB 최종 1건·멱등성·Consumer/Mock·eventId 중복 방지·로그 상관관계는 별도 기능 검증 항목입니다. 이 부하 요약만으로 통과 처리하지 않습니다. API 수신·처리 로그 원본이 필요하면 해당 시간 범위로 수집해 evidence에 첨부합니다.",
"",
"원본: run.json / evidence/k6-summary.json / evidence/observations.jsonl / evidence/k6.log. 미설정·미측정·수집 오류는 0이나 성공으로 대체하지 않습니다."
