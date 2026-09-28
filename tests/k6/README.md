# Ticketing k6 최종 수정본 — 2026-09-09

기존 `ticketing-k6-preparation-v1.4-final.zip`의 시나리오 6개를 수정하고, 선택용 HTTP 관측 스크립트와 결과 분석기를 포함했다.

**장애 시험은 기존 팀 절차에 따른 복구 확인과 Grafana 캡처가 기본이다. 아래 장애 관측용 k6와 시간 분석은 Ingress·Backend 연결 후 필요한 시험에서만 사용한다.** k6가 장애를 주입하거나 Kubernetes 설정을 변경하지 않는다.

## 먼저 알아둘 상태

- API 기준: 기존 패키지가 기록한 Node.js Backend `feature/backend-node`, 커밋 `459306d`의 계약. 이번 수정에서 최신 GitHub HEAD나 실제 배포 상태를 재확인하지는 않았다.
- 검증 완료: JavaScript 로직 모의 실행 23건, Python 분석기 14건, 문법 검사. 검증 상세는 `VALIDATION.md`에 있다.
- 미검증: 실제 k6 실행기, 실제 Ingress·Backend·Redis·PostgreSQL·Kafka, 실제 장애·부하 결과.
- 준비할 값: 실제 `BASE_URL`, 필요 시 Ingress Host, 행사·사용자·좌석 ID. 예시 ID가 실제 DB에 존재한다고 가정하지 않는다.
- 추가 Python 패키지나 k6 확장 모듈은 필요하지 않다. 기본 실행은 이미 설치된 k6와 Bash를 사용한다. 선택 분석기는 Python 3.10 이상 표준 라이브러리만 사용한다.

## 이번에 고친 내용

| 항목 | 최종 동작 |
|---|---|
| 예약 앞 단계 실패 누락 | join부터 booking까지 한 흐름으로 기록. 중간 실패도 `flow_failed`에 포함 |
| 입장 대기 제한 | 사용자 요청에 따라 기본 600초 유지. 1초 간격으로 재확인하며 요청 timeout과 마지막 sleep을 남은 시간으로 제한 |
| 잘못된 성공 판정 | 성공 코드를 명시하면 해당 코드만 인정. 예약 200을 201 성공으로 처리하지 않음 |
| 409·401 처리 | 409는 Hold·Booking 요청의 업무 충돌로만 허용. Queue의 409와 verify 만료는 실패 |
| 응답 본문 검증 | verify 200이라도 `status=admitted`가 없으면 입장 실패. 500의 waiting 본문도 대기로 인정하지 않음 |
| 장애 관측 요청 발생 | load·queue-load의 failover 모드를 `constant-arrival-rate`로 변경 |
| VU 산정 | HTTP 한 요청이 아닌 전체 iteration 시간 예산으로 산정 |
| 실제 요청 수 | k6 기본 `http_reqs`를 JSON Point에서 합산. `BOOKING_RATE`와 HTTP req/s 구분 |
| 누락·중단 | `dropped_iterations`, `flow_started - flow_completed`를 따로 확인 |
| 설정·데이터 오류 | `2abc` 같은 숫자, 부족한 예약 데이터, 중복 좌석·사용자, 잘못된 VU 조합을 실행 전에 거부 |
| 결과 저장 | 회차별 summary·JSON Points·실행 로그·종료 코드 저장, 동일 회차 덮어쓰기 방지 |
| 시간 해석 | 무표본·실패 미관측·복구 미확인을 구분. 시간 값은 선택적으로 계산 |

## 파일과 용도

| 파일 | 용도 |
|---|---|
| `scenarios/smoke.js` | `/healthz`, HTTP 200 및 `status=ok` 확인 |
| `scenarios/e2e.js` | 실제 사용자·좌석으로 Queue → verify → Hold → Booking 1회 |
| `scenarios/load.js` | 단일 API 단계형 부하, 선택적으로 장애 전후 조회 관측 |
| `scenarios/queue-load.js` | Queue·입장 확인 부하, 선택적으로 Redis 관련 요청 관측 |
| `scenarios/seat-concurrency.js` | 서로 다른 사용자의 동일 좌석 경쟁 |
| `scenarios/booking-stream.js` | 서로 다른 사용자·좌석으로 예약 흐름을 계속 시작 |
| `scenarios/http-continuity-probe.js` | 지정 URL의 HTTP 상태 관측. 선택용 |
| `scripts/run.sh` | 실행·원자료 저장 공통 명령 |
| `tools/analyze-k6-json.py` | 결과 집계와 선택 시간 분석 |
| `tests/` | 수정한 로직의 회귀 검증. VM에서 부하 시험할 때 실행할 필요 없음 |

`common/`·`config/`도 함께 바뀌었으므로 개별 시나리오 파일만 이전 폴더에 섞지 말고 이 폴더 전체를 사용한다.

## 입장 대기와 대기열 적체의 구분

기본 최대 입장 대기는 600초이고 재확인 간격은 1초다. 한 번의 HTTP 요청 timeout 2초와는 다른 설정이다. 대기 중 응답이 계속 오면 최대 600초까지 재확인하고, admitted 응답이 오면 즉시 다음 단계로 넘어간다. HTTP 오류는 그대로 실패로 기록하며 600초 동안 오류를 숨겨 재시도하지 않는다.

600초는 k6가 기다려 주는 한도이며 백엔드에 대기열을 만드는 설정은 아니다. 대기열 적체 시험에는 백엔드가 입장량을 제한하고, 기다리는 사용자에게 waiting 상태를 반환하며, 실제 대기 중인 인원을 관측할 수 있어야 한다. 즉시 admitted를 반환하는 구현에서는 이 값을 늘려도 대기열 적체가 생기지 않는다.

대기 제한을 600초로 유지하므로 Queue 시험의 종료 대기와 VU 감소 유예도 기본 604초(추가 GET 포함 시 606초)다. 따라서 35분 부하 단계가 끝나도 진행 중인 흐름을 기다리는 시간이 추가될 수 있고, 감소 구간의 실제 VU가 즉시 목표값까지 줄지 않을 수 있다. 예약 스트림 종료 대기는 기본 608초다. 이는 종료까지 여유를 주는 설정이며 대기를 강제로 발생시키는 설정은 아니다.

## 1. 접속 확인부터 실행

저장소의 `tests/k6` 폴더에서 실행한다. 아래 VIP·ID는 실제 환경 값으로 교체한다.

```bash
export BASE_URL='https://api.ticketing.local'
# 실습용 자체 서명 인증서 또는 VIP-인증서 이름 불일치 환경에서만 사용한다.
export K6_INSECURE_SKIP_TLS_VERIFY=true
# k6 코드 안에서 hostname을 VIP로 연결한다. 실제 hostname과 VIP로 교체한다.
export K6_HOSTS_JSON='{"api.ticketing.local":"10.1.93.69"}'
# 추가 Header가 필요한 경우에만 설정한다.
# export REQUEST_HEADERS_JSON='{"X-Test-Header":"value"}'

bash scripts/run.sh smoke
```

`/healthz`가 실제 배포와 다르면 `HEALTH_PATH`를 지정한다. Smoke는 HTTP 상태와 본문 check가 모두 성공해야 종료 코드 0이다.

각 실행 결과는 `results/<RUN_ID>-<시나리오>/`에 저장된다.

| 파일 | 확인 내용 |
|---|---|
| `summary.json` | 전체 집계: 요청 수·req/s·p95·실패율·사용자 정의 메트릭 |
| `points.json` | 시간과 태그가 붙은 원자료. 일반 JSON 배열이 아닌 JSON Lines |
| `console.log` | k6 출력, 설정 오류, 중단 iteration 및 threshold 결과 |
| `run.txt` | 실행 시작·종료 UTC 시각, k6·로그 저장·최종 종료 코드 |

`RUN_ID`를 생략하면 실행마다 자동 생성한다. 같은 이름의 결과 폴더가 있으면 덮어쓰지 않고 중단한다.

## 2. 기본 부하·기능 확인

```bash
# 실제 존재하는 사용자 101·행사 1·AVAILABLE 좌석 1001의 예시
USER_ID=101 EVENT_ID=1 SEAT_ID=1001 bash scripts/run.sh e2e

# 좌석 조회 단계형 부하. 기본 전체 단계는 35분이다.
TARGET_PATH=/seats/1 EXPECTED_STATUS_CODES=200 bash scripts/run.sh load

# Queue 등록과 입장 확인 부하
EVENT_ID=1 bash scripts/run.sh queue-load

# 별도 AVAILABLE 좌석 1002를 놓고 서로 다른 실제 사용자 5명이 경쟁하는 예시
EVENT_ID=1 SEAT_ID=1002 USER_IDS=101,102,103,104,105 bash scripts/run.sh seat-concurrency
```

E2E·동시성·예약 스트림은 실제 예약 데이터를 만든다. 앞 시험에서 예약한 좌석을 다시 사용하면 충돌할 수 있으므로 새 좌석을 준비하거나 데이터 담당자가 합의된 초기화를 수행한 뒤 재시험한다.

동일 좌석 시험은 Hold 성공 1건·나머지 업무 충돌·예약 성공 1건을 기능 기준으로 확인한다. 준비 단계에서 사용자별 입장을 순서대로 확인하므로 먼저 입장한 사용자의 유효기간이 지나지 않는 인원·시간으로 실행한다. 기본 setup 제한은 15분이며 실제 입장 TTL은 배포 상태에서 확인한다.

기존 패키지의 입장 구현은 토큰이 유효하면 즉시 admitted를 반환한다. 따라서 Queue 부하 결과만으로 대기 인원이 누적되는 적체를 구현·검증했다고 쓰지 않는다. 실제 입장 제한 기능이 추가되면 응답 계약과 대기 시간 설정을 다시 맞춘다.

공통 부하 단계는 기존 값을 유지했다.

| 단계 | 증가·감소 시간 | 유지 시간 | 목표 VU |
|---|---:|---:|---:|
| Warm-up | 1분 | 3분 | 10 |
| Normal | 2분 | 5분 | 50 |
| Peak | 3분 | 10분 | 200 |
| Spike | 30초 | 2분 | 500 |
| Recovery | 1분 | 7분 | 20 |
| 종료 | 30초 | — | 0 |

위 값은 시험 계획값이다. 실행 전 VM 자원과 팀에서 합의한 부하를 확인한다. `WARMUP_VUS`, `NORMAL_VUS`, `PEAK_VUS`, `SPIKE_VUS`, `RECOVERY_VUS`와 각 `*_RAMP_DURATION`, `*_HOLD_DURATION`, `STOP_DURATION`으로 조정한다. HPA 결과를 기록할 때는 실제 HPA 설정·Pod CPU requests·Ready Pod 변화를 함께 확인한다.

## 3. 장애 중 요청 관측 — 선택

조장의 장애 주입·복구 절차에 맞춰 관측이 필요한 회차에서만 실행한다. 장애 전 정상 요청 구간과 복구 후 요청 구간이 모두 남도록 실행 시간을 정한다.

```bash
# PostgreSQL 관련 좌석 조회 경로 예시: 1 iteration/s, 요청 timeout 2초
TEST_MODE=failover TARGET_PATH=/seats/1 FAILOVER_RATE=1 \
  FAILOVER_DURATION=10m REQUEST_TIMEOUT=2s bash scripts/run.sh load

# Redis 관련 Queue → verify 흐름: 1 flow/s
TEST_MODE=failover EVENT_ID=1 FAILOVER_RATE=1 FAILOVER_DURATION=10m \
  REQUEST_TIMEOUT=2s QUEUE_MAX_WAIT_SECONDS=600 bash scripts/run.sh queue-load

# 단일 URL 관측. 대상 주소를 자동으로 추정하지 않는다.
TARGET_URL="$BASE_URL/healthz" TEST_ID=P-01 RATE=1 DURATION=10m \
  REQUEST_TIMEOUT=2s bash scripts/run.sh http-continuity-probe
```

이 모드에서 `FAILOVER_VUS`는 더 이상 쓰지 않는다. 이전 명령을 그대로 넣으면 변경해야 할 변수명이 오류 메시지로 나온다. `FAILOVER_RATE`는 초당 시작할 iteration 수, `PRE_ALLOCATED_VUS`는 그 시도를 처리할 미리 준비한 VU 수다. 한 VU가 느린 요청을 처리하는 동안 다른 VU가 다음 시도를 시작할 수 있어야 한다. [k6 VU 할당 공식 문서](https://grafana.com/docs/k6/latest/using-k6/scenarios/concepts/arrival-rate-vu-allocation/)

VU 기본 산정은 `ceil(rate × iteration 시간 예산 × 1.5)`에 최소 2·기본 할당 상한 100을 적용한다. 긴 대기 제한만으로 900개 이상의 VU를 자동 할당하지 않기 위한 기본값이며, 100 VU가 목표 rate 유지에 충분하다는 뜻은 아니다. 실제 대기가 길어지면 시작하지 못한 시도가 발생할 수 있으므로 `dropped_iterations`를 확인하고 합의한 발생 속도와 명시적 `PRE_ALLOCATED_VUS`·`MAX_VUS`를 조정한다.

| 흐름 | 기본 시간 예산 | rate=1일 때 기본 사전 VU |
|---|---:|---:|
| 조회·HTTP probe | 요청 timeout 2초 | 3 |
| Queue → verify | join 2초 + verify 전체 대기 제한 600초 | 100 (상한 적용) |
| Queue → verify → 추가 GET | 2초 + 600초 + 2초 | 100 (상한 적용) |
| 예약 스트림 | join·Hold·Booking 각각 2초 + verify 전체 600초 | 100 (상한 적용) |

`MAX_VUS` 기본값은 사전 VU와 같다. 직접 지정할 때는 `MAX_VUS >= PRE_ALLOCATED_VUS`여야 한다. `GRACEFUL_STOP` 기본값은 위 시간 예산을 올림한 값에 2초를 더한다. 너무 짧게 지정하면 시작 전에 거부한다. 종료 시 진행 중인 iteration이 grace 기간 안에 끝나지 못하면 중단될 수 있다. [k6 graceful stop 공식 문서](https://grafana.com/docs/k6/latest/using-k6/scenarios/concepts/graceful-stop/)

`dropped_iterations > 0`이면 예정한 시도가 모두 발생한 결과가 아니다. 해당 회차를 목표 속도가 유지된 정상 측정으로 판정하지 말고 부하·VU·발생기 자원을 확인한다. 이 조건만 실행 유효성 threshold로 두었으며 장애 중 오류율·p95 합격선은 임의로 추가하지 않았다.

## 4. 예약 스트림 — 데이터 준비 후 실행

`data/booking-cases.json`의 3개 행은 형식 예시다. 실제 존재하는 사용자·행사·AVAILABLE 좌석으로 교체한다. 기본 실행 길이는 3초이고 `BOOKING_RATE=1`이므로 3개 행을 사용한다.

```bash
BOOKING_RATE=1 BOOKING_DURATION=3s bash scripts/run.sh booking-stream

# 별도 데이터 파일을 쓰는 경우. 이 예시는 600개 이상의 실제 예약 데이터가 필요하다.
BOOKING_CASES_FILE="$PWD/data/booking-cases.json" \
  BOOKING_RATE=1 BOOKING_DURATION=10m bash scripts/run.sh booking-stream
```

필요 행 수는 `ceil(BOOKING_RATE × BOOKING_DURATION 초)`다. 같은 행사에서 같은 좌석이나 사용자를 반복하지 않는다. 데이터가 부족하면 시작 전에 중단하며 순환 재사용하지 않는다. 큰 bigint ID는 정밀도 손실을 막기 위해 JSON 문자열로 넣는다. `BOOKING_CASES_FILE`에 상대 경로를 쓰면 `scenarios/` 기준으로 해석하므로 별도 파일은 절대 경로를 권장한다. 이 패키지는 단일 로컬 k6 실행을 기준으로 한다.

정상 즉시 입장 흐름 한 번에는 보통 HTTP 요청 4개가 발생한다. 앞 단계 실패나 verify 반복 조회가 있으면 달라진다. `BOOKING_RATE=1`을 HTTP 1 req/s라고 쓰지 말고 실제 `http_reqs`를 기록한다.

## 5. 결과 읽는 기준

| 항목 | 의미 |
|---|---|
| `http_reqs` | 실제 HTTP 요청 수. summary의 rate가 실제 집계 req/s |
| `http_req_failed` | 해당 HTTP 요청의 기대 상태 코드에서 벗어난 비율 |
| `flow_started` / `flow_completed` | Queue·예약 흐름의 시작 수 / 결과를 기록한 완료 수 |
| `flow_failed` | 완료된 전체 흐름 중 최종 목표에 도달하지 못한 비율. 업무 충돌도 포함 |
| `flow_successes` | Queue 흐름은 입장 및 선택 GET 성공, 예약 흐름은 Booking 201 성공 |
| `flow_conflicts` | 예약 흐름이 Hold·Booking 업무 충돌로 끝난 건수 |
| `failed_step` | queue_join / auth_verify / seat_hold / booking 등 실패 단계 |
| `dropped_iterations` | VU 부족 등으로 시작하지 못한 시도 |

409를 정상적인 좌석 경쟁 응답으로 받아도 해당 사용자의 예약은 성공하지 않은 것이다. 따라서 HTTP 실패율은 0이고 예약 흐름 실패율은 0보다 클 수 있다. 반대로 verify가 200이지만 필수 본문이 잘못된 경우도 HTTP 상태 지표와 흐름 결과가 달라진다. [요청별 기대 상태 코드 설정](https://grafana.com/docs/k6/latest/javascript-api/k6-http/params/)

예약 API만 필터링하면 앞 단계에서 실패한 흐름이 빠진다. `api=booking` 결과는 상세 참고값으로 사용하고 `flow_failed`, 단계별 결과, 시작·완료 차이를 함께 기록한다. 시작·완료 차이가 있으면 완료된 흐름의 성공률을 전체 성공률로 쓰지 않는다.

**Booking 201은 결제·알림 완료나 Kafka 무손실을 증명하지 않는다.** 기존 계약에서는 Kafka 발행 실패가 있어도 예약 201이 반환될 수 있다. DB 담당의 기존 검증 절차로 booking·booking_seat·payment·processed_event의 업무 결과와 중복 여부를 확인하고, 알림은 기존 로그로 대조한다.

부하·장애 관측 스크립트의 종료 코드 0만으로 서비스가 합격했다고 판정하지 않는다. 기능 시험인 Smoke·E2E·동시성의 조건과, 장애 관측의 결과 기록·팀 합격 기준을 구분한다.

## 6. 분석기 — 선택

`results/실제-회차-폴더`를 생성된 경로로 바꾼다. 기본 분석에는 장애 시각이 필요하지 않다.

```bash
python3 tools/analyze-k6-json.py \
  --input results/실제-회차-폴더/points.json \
  --summary results/실제-회차-폴더/summary.json \
  --output results/실제-회차-폴더/analysis.json

# 예약 또는 Queue 전체 흐름 결과
python3 tools/analyze-k6-json.py \
  --input results/실제-회차-폴더/points.json --metric flow_failed
```

HTTP Point 외에 `probe_failed`도 `--metric probe_failed`로 선택할 수 있다. `--api booking`은 HTTP 상세 분석에만 사용한다. 분석기는 전체 흐름 실패와 API별 결과를 함께 남긴다. JSON 원자료 형식은 k6의 JSON Lines 출력 기준이다. [k6 JSON 출력 공식 문서](https://grafana.com/docs/k6/latest/results-output/real-time/json/)

시각 분석이 필요한 회차에 한해 실제 기록한 장애 명령 시각을 넘긴다.

```bash
python3 tools/analyze-k6-json.py \
  --input results/실제-회차-폴더/points.json \
  --fault-time '2026-09-09T12:00:00Z' --consecutive-successes 5
```

위 시각도 형식 예시다. `--fault-time`은 포함, 선택 `--end-time`은 제외하는 구간으로 집계한다. 서로 다른 시험 회차 파일을 합치지 않는다.

`until_stabilized_seconds`는 최초 실패 완료 표본에서 마지막 관측 실패 뒤 정상 5개 완료 표본이 쌓인 시각까지의 간격이다. 실제 단절 시간, Primary 전환 시간, Pod 복구 시간으로 쓰지 않는다. 병렬 요청·응답 순서·timeout·관측 구간 길이에 영향을 받는다. 실패 구간 목록은 관측 기록이며 합계를 정확한 장애 지속시간이라고 표현하지 않는다.

표본 없음, 실패 미관측, 정상 표본 부족에 따른 복구 미확인은 서로 구분한다. 실패가 없다고 복구 0초를 출력하지 않는다. `T_restore_cmd`를 기준으로 한 구성요소 원상복구 시간은 기존 장애 기록에서 별도로 확인한다. 이번 코드 실행을 위해 0.5초 CLI 폴링이나 정밀 시간 측정을 추가할 필요는 없다.

## 주요 설정 기본값

| 변수 | 기본값·규칙 |
|---|---|
| `REQUEST_TIMEOUT` | Queue·예약·failover·probe 2s, 표준 load·smoke 30s |
| `QUEUE_MAX_WAIT_SECONDS` | 600. 대기열에서 입장을 기다리는 한 흐름의 최대 시간 |
| `QUEUE_POLL_INTERVAL_SECONDS` | 1 |
| `FAILOVER_RATE` / `FAILOVER_DURATION` | 1 iteration/s / 10m |
| `BOOKING_RATE` / `BOOKING_DURATION` | 1 flow/s / 3s |
| `RATE` / `DURATION` | HTTP probe 전용. 1 iteration/s / 10m |
| `THINK_TIME_SECONDS` | 표준 load·queue-load에서만 1초. arrival-rate 모드에서는 사용하지 않음 |
| `EXPECTED_STATUS_CODES` | smoke·load·probe 기본 200. 예약 계약은 join 202 / verify 200 / Hold 200 / Booking 201 |
| `REQUEST_HEADERS_JSON` | 필요 시 Host 등 공통 요청 헤더 JSON. Smoke에도 적용 |
| `SETUP_TIMEOUT` | 동일 좌석 동시성 준비 단계 15m. 여러 사용자의 순차 대기는 준비 제한과 실제 admission TTL을 함께 확인 |

API 경로를 바꾸는 변수는 `HEALTH_PATH`, `QUEUE_JOIN_PATH`, `AUTH_VERIFY_PATH`, `HOLD_PATH_TEMPLATE`, `BOOKING_PATH`다. Queue 상태 코드·본문은 `common/queue.js`의 `buildQueueConfig()`에 나열한 환경변수로 지정한다. 실제 계약이 바뀌었다면 Smoke·E2E부터 확인한 후 부하를 실행한다.
