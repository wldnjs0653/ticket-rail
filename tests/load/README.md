# 최종 부하시험 — Ansible + k6 보완판 r3

최종 시험의 실행 진입점은 **Ansible Playbook**입니다. Ansible이 실행 대상·필수 파일을 확인하고, 장시간 시험을 시작·대기한 뒤 성공/실패 상태와 결과를 수거합니다. k6는 JavaScript 시나리오로 실제 요청을 보냅니다. Bash+jq는 사전 점검·실시간 감시·자동 중단·집계를 수행하는 보조 프로그램입니다.

**별도로 작성한 Python 실행·분석 프로그램은 사용하지 않습니다. Ansible 자체의 Python 런타임은 필요합니다.** Python용 kubernetes 클라이언트나 사용자 작성 .py 파일을 추가하지 않습니다. 기존 ZIP 파일명을 유지했지만 ‘Python 런타임도 전혀 불필요’라는 뜻은 아닙니다.

## 최종 시험 실행

Ansible 컨트롤러에서 압축을 풀고 다음 순서로 실행합니다.

```bash
cp inventories/hosts.example.ini inventories/hosts.ini
cp config.env.example config.env
# config.env의 Event·좌석 조회 경로·Prometheus·DB 설정을 실제 환경에 맞춥니다.
# 대기열 입장 후 좌석 조회까지 시험한다면:
# QUEUE_READ_AFTER_ADMISSION=true

# 사전 점검만 수행
ansible-playbook -i inventories/hosts.ini playbooks/final-load.yml -e test_action=check

# 최종 대기열 시험 1회 실행 — 기본값 queue
ansible-playbook -i inventories/hosts.ini playbooks/final-load.yml
```

이미 끝낸 smoke·E2E·조회 부하시험을 순서대로 재실행하지 않습니다. 선택한 최종 시험 1개만 실행합니다. 조회 부하 시험을 선택하려면 명령 끝에 `-e test_scenario=load`를 붙입니다. `--check`는 실제 접속 점검이 아니므로 이 Playbook에서는 차단합니다.

기존 설정을 가져올 때는 다음과 같이 실행합니다.

```bash
./import-config.sh /기존경로/config.json /기존경로/https-grafana-v3/config/observability.json
ansible-playbook -i inventories/hosts.ini playbooks/final-load.yml -e test_config=/절대경로/config.imported.env -e test_action=check
```

기존 namespace·DB·부하 크기·감시 한계·추가 PromQL을 가져옵니다. 이전 .local 주소와 내부 CA 경로는 가져오지 않습니다. 현재 설정 파일은 덮어쓰지 않습니다.

## 각각 언제 무엇을 하나

| 시점 | Ansible | k6·보조 프로그램 |
|---|---|---|
| 시작 전 | 실행 서버 1대·시나리오·설정 파일 확인, 결과 디렉터리 생성 | Bash가 DNS·HTTPS·지표·서버 정상 상태 점검 |
| 시험 시작 | 선택한 시험 실행, 비동기 작업 상태 확인 | k6가 가상 사용자와 HTTP 요청 실행 |
| 시험 중 | 실행 완료 또는 제한시간 도달까지 대기 | k6가 응답 측정, Bash가 자원을 감시하고 필요 시 k6 중단 |
| 종료 후 | 종료코드 저장, 결과 압축·컨트롤러 수거, 실패를 실패로 반환 | k6 요약, Bash의 큐 회복 관측·서버 지표 수집·보고서 생성 |

Ansible이 측정 엔진은 아니며, k6가 Pod를 늘리거나 큐 입장을 허가하는 것도 아닙니다. 그 처리는 서버 API와 Kubernetes가 합니다.

## 실행 서버와 결과 위치

기본 inventory는 localhost이므로 Ansible 컨트롤러에서 k6가 실행됩니다. 전용 k6 서버를 사용하려면 inventories/hosts.ini의 localhost를 실제 서버 **한 대**로 교체하고 automation_root를 원격 패키지 경로로 지정합니다. 패키지·config.env·k6·kubectl·kubeconfig는 그 실행 서버에 준비되어 있어야 합니다. 실행 호스트의 CPU·메모리를 감시합니다.

Ansible 컨트롤러에는 Ansible과 그 Python 런타임이 필요합니다. 실행 서버에는 Ansible 모듈이 사용하는 지원 Python, Bash 4+, k6, jq, curl, kubectl, GNU coreutils, awk, setsid, getent, tar가 필요합니다. 연결 계정은 kubeconfig로 필요한 읽기·exec 권한을 가져야 합니다. 이 Playbook은 패키지나 도구를 임의로 설치하지 않습니다.

서버 결과: `results/ansible-queue-<고유값>/report.md`. 컨트롤러 수거본: `collected/ansible-queue-<고유값>.tar.gz`. 실패·차단도 결과를 수거한 다음 Ansible 작업을 실패로 표시합니다. 초기 DNS·인증서 오류로 내부 보고서가 만들어지지 않아도 ansible-execution.json과 실패 보고서는 보존합니다.

기본 최대 실행시간은 3시간입니다. 변경하려면 `-e test_timeout_seconds=초`를 지정하며 계획한 시험·회복·집계 시간보다 길게 설정합니다. 제한시간에 도달하면 보조 실행기에 INT를 전달하고 종료를 기다립니다. Ansible 비동기 작업이므로 컨트롤러 터미널의 Ctrl+C만으로 원격 부하가 종료된다고 생각하면 안 됩니다. 시험 실행 서버의 해당 작업을 확인해야 하며, 자체 감시와 최대 실행시간 제한은 계속 적용됩니다.

## 변경된 HTTPS 환경

`BASE_URL=auto`가 기본값입니다. app namespace의 Ingress 중 backend Service로 연결되고 TLS host가 지정된 도메인을 찾습니다. 후보가 하나라면 그 HTTPS 주소를 사용합니다. 여러 후보이거나 권한이 부족하면 임의 선택하지 않고 BASE_URL에 실제 주소를 지정하도록 안내합니다.

```bash
# 자동 탐색 대신 직접 지정할 때만 사용. 아래 도메인은 실제 주소로 바꿉니다.
BASE_URL=https://api.보유도메인
```

- 기존 `api.ticketing.local`과 내부 Root CA 파일 설정을 기본값에서 제거했습니다.
- 실행 호스트에서 DNS 해석을 확인하고, 실제 HTTPS health 경로를 curl로 검증합니다.
- k6도 TLS 검증을 켜서 실행합니다. 인증서 오류를 무시하거나 VIP로 접속을 강제하지 않습니다.
- k6 호스트와 사용자 PC가 해당 내부 DNS를 사용하고 VIP로 통신할 수 있어야 합니다. 공인 인증서만 적용했다고 DNS 설정까지 자동으로 바뀌지는 않습니다.
- 예전에 설정한 SSL_CERT_FILE이 내부 CA 전용 파일을 가리키면 공인 인증서 검증을 방해할 수 있으므로 확인하세요. 시스템 신뢰 저장소를 임의로 수정하지는 않습니다.
- cert-manager 발급·갱신과 Ingress TLS Secret은 이미 변경된 서버 구성을 사용합니다. 이 시험 패키지가 인증서를 새로 발급하거나 DNS/Secret을 변경하지 않습니다.

DNS-01은 공개 DNS의 TXT 레코드로 도메인을 검증하므로 웹 서버를 인터넷에 공개하지 않고도 발급할 수 있습니다. 발급 검증에 쓰는 공개 DNS와 사용자가 VIP를 찾는 내부 DNS는 역할이 다릅니다. [Let’s Encrypt 공식 설명](https://letsencrypt.org/docs/challenge-types/)

## 복원한 감시·자동 중단

감시는 기본 10초 간격입니다. 조회 자체의 시간이 추가될 수 있고, API 호출은 timeout으로 제한합니다. 지속시간은 시스템 시각 변경의 영향을 줄이기 위해 monotonic clock을 사용합니다.

| 조건 | 처리 / 기본값 |
|---|---|
| Node NotReady | 관측 즉시 중단 |
| Backend Ready 최소 2개 미달 또는 실행 중 Pod 중 미준비 존재 | 30초 지속 시 중단 |
| 새 컨테이너 재시작 / 현재 OOMKilled | 관측 즉시 중단; 기존 재시작 횟수와 구분 |
| Backend Deployment template 변경 | 관측 즉시 중단 |
| PostgreSQL Primary 읽기 실패·Standby 응답 | 관측 즉시 중단; 읽기 전용 SELECT |
| Backend scrape 경로·클러스터/HPA 관측 실패 | 60초 지속 시 중단 |
| k6 호스트 CPU 95% 이상 | 60초 지속 시 중단 |
| k6 호스트 메모리 여유 10% 미만 / 결과 디스크 2GiB 미만 | 관측 즉시 중단 |
| 최근 60초 HTTP 실패율 1% 이상 | 해당 상태가 추가 60초 지속되면 중단 |
| Grafana health 실패 | GRAFANA_URL 설정 시 60초 지속 감시 |
| HPA 최대 Replica에서 CPU가 목표 이상 | 60초 지속 시 중단 — 계획서 중단 조건 보강 |
| dropped_iterations 발생 | 관측 시 중단 — 최종 집계에서도 확인 |
| 감시기·실시간 집계 경로 오류 | 중단하고 원인 기록 |

HTTP 실패율은 전체 시험 누적 평균이 아닙니다. k6의 expected_response 분류를 사용해 1초 단위 버킷으로 최근 60초를 집계합니다. 최초 60초의 이력이 모인 후 지속시간을 판단하므로, 계속 실패하더라도 이 조건만으로는 시작 약 120초 이후에 중단될 수 있습니다. 이는 원본 Watchdog의 ‘최근 1분 + 1분 지속’ 의미를 유지한 것입니다. 버킷과 관측 주기에 따른 지연은 있습니다. 시험에서 정상 충돌로 지정한 409는 HTTP 실패율에 포함되지 않을 수 있으며, 응답 코드별 건수는 별도로 유지됩니다.

원자료 전체를 디스크에 계속 쌓지 않고 FIFO로 집계해 최근 구간만 유지합니다. 요약과 감시 관측은 보존합니다. 자동 중단은 k6에 INT를 전달하고 기본 30초 안에 종료되지 않으면 TERM/KILL로 종료합니다. 강제 종료 단계에서는 최종 k6 요약이 없을 수 있으며, 이때도 중단 사유는 남습니다. 자동 중단·시작 차단은 종료코드 20, 사용자 중단은 130입니다. 종료코드 0은 성능 SLA 합격과 동일하지 않습니다.

감시 설정은 config.env의 WATCH_INTERVAL, BASELINE_SECONDS, BACKEND_UNREADY_SECONDS, COLLECTION_FAILURE_SECONDS, HTTP_FAILURE_RATIO, HTTP_FAILURE_SUSTAIN_SECONDS, EXECUTOR_* 등을 사용합니다. WATCH_DB는 원본 database.enabled를 계승하며 기본 1입니다. 별도 DB 결과 검증인 DB_VERIFY와는 다른 설정입니다.

## 지표 설정과 누락 처리

기존 HTTP·큐 쿼리와 Redis 메모리 쿼리를 복원했고, 기존 extra_promql 및 observability 설정을 가져올 수 있습니다. 쿼리를 임의의 다른 exporter 지표로 자동 치환하지는 않습니다.

원본에도 비어 있던 Redis 지연·PostgreSQL 연결/잠금/트랜잭션 지연·Kafka Produce/ISR/lag·디스크 항목은 실제 exporter 이름과 라벨이 필요합니다. **실제 서버에 접속하지 않은 상태에서 이를 확정한 것으로 표시하지 않습니다.** metrics.json 또는 가져온 metrics.imported.json에서 해당 query를 채웁니다. 치환 변수는 `__NS__`, `__DATA__`, `__BACKEND__`, `__EVENT__`, `__RATE__`, `__WINDOW__`입니다.

load/queue는 기본 REQUIRE_PLAN_METRICS=1이므로 계획서의 API·자원 지표가 미설정/미수집이면 시작 전에 차단합니다. load에는 큐 지표를 강제하지 않으며, queue에는 실제 queue_depth가 필수입니다. 서버 큐 대기 p95 등 보조 지표의 부재는 경고로 남깁니다. 부분 탐색을 의도한 경우에만 REQUIRE_PLAN_METRICS=0으로 설정할 수 있습니다. 이때도 핵심 API/Replica/CPU/메모리/HPA와 queue 시험의 depth 점검은 유지되며, 누락 지표를 0이나 성공으로 처리하지 않습니다.

Prometheus query_range는 시험 종료 후 해당 시간 구간을 수집합니다. 기본 간격 15초, rate 구간 1분입니다. 서버 간 시간 동기화가 전제이며 매우 짧은 시험은 scrape 이력이 부족할 수 있습니다. `http_requests_total`은 경로·상태별 응답 완료 증가량 추정치이며 다른 트래픽도 섞일 수 있습니다. k6 요청 접수 건수와 일치한다고 판정하지 않습니다.

Prometheus 자동 포트 포워딩은 MANAGE_PROMETHEUS_FORWARD=1에서, 지정한 localhost URL에 접근할 수 없을 때만 시작합니다. 기존 연결은 종료하지 않습니다. Grafana 대시보드나 Prometheus receiver는 이 패키지가 변경하지 않습니다. 기존 remote write를 사용한다면 K6_OUT과 K6_PROMETHEUS_RW_SERVER_URL을 설정할 수 있습니다.

## 시험과 결과

| Ansible 선택 변수 | 수행 내용 |
|---|---|
| test_scenario=smoke | /health/live 1회, HTTP 200·status=ok |
| test_scenario=load | /seats/{eventId} 시간 기반 반복 조회; 기본 10→50→200→500→20 VU |
| test_scenario=queue | 신규 사용자 join→verify 폴링, 큐 적체·입장·회복 관측 |
| test_scenario=e2e | 실제 사용자 1명 입장→Hold→예약 |
| test_scenario=concurrency | 실제 사용자 N명 입장 후 동일 좌석 Hold 경쟁, 승자만 예약 |

load 기본 구간은 준비 1+3분, Normal 2+5분, Peak 3+10분, Spike 30초+2분, Recovery 1+7분, 종료 30초로 총 35분입니다. 자원에 맞게 VU·기간을 조정하며 최종 시험에는 계획서의 Recovery 7분 이상을 반영하세요. load의 건수는 고정값이 아니라 실행 시간과 응답 속도에 따라 달라집니다.

queue는 기본 신규 사용자 3→5→10→20명/초 후 유입을 0으로 낮춥니다. 이 값은 HTTP RPS가 아닙니다. 시험용 생성 사용자 ID를 API가 허용해야 합니다. QUEUE_READ_AFTER_ADMISSION=true이면 입장 후 좌석 조회를 반복하며 TTL 기본값은 QUEUE_ADMISSION_TTL_SECONDS=600입니다. 스크립트가 서버의 입장 정원을 만들어 주거나 TTL을 갱신하지 않습니다.

USER_ID/USER_IDS/SEAT_ID는 실제 테스트 데이터여야 합니다. TARGET_PATH와 EVENT_ID를 일치시키세요. 이미 예약된 좌석을 재사용하면 충돌하며, 데이터 초기화·삭제는 하지 않습니다.

보고서는 `results/<실행ID>-<시험>/report.md` 하나부터 봅니다.

1. k6 요청·응답: 시도 수, 2xx, 409, 429, 나머지 4xx, 5xx, 네트워크 실패, RPS, p50/p95/p99.
2. 큐 적체·해소: 실제 서버 depth 시계열과 k6 대기 응답·입장 결과.
3. API 내부 결과: 경로·상태별 처리량·지연, 선택적 API 로그·DB 확인.
4. 5차 기획서의 나머지 요구 지표와 자동 중단 사유.

근거는 evidence/에 모읍니다. 전체 응답 원문을 덤프하지 않고 최초 N개 iteration의 제한된 표본만 남깁니다(SAMPLE_ITERATIONS, 기본 1). API_LOG_SELECTOR를 실제 Pod 라벨로 지정하면 해당 시간의 API 로그를 가져옵니다. 기본 컨테이너별 5,000줄 제한이므로 전체 수신 원장은 아닙니다. DB_VERIFY=1은 E2E/동시성 뒤 기존 booking/booking_seat/payment 스키마에서 좌석 연결 1건·CONFIRMED·APPROVED를 읽기 전용으로 확인합니다.

Hold TTL, 동일 Idempotency-Key 재요청, Consumer/Mock 전체 처리, 동일 eventId 재처리 중복 방지, 로그 상관관계는 별도 기능 검증 근거가 필요합니다. HTTP 2xx만으로 통과시키지 않습니다. 보고서 재생성은 `./report.sh results/<실행ID>-load`입니다.

검증: `./tests/guard-test.sh`는 실제 서버 접근 없이 중단 규칙을 확인합니다. 추가 로컬 통합 검증 내역은 VALIDATION.md에 있습니다. 실제 클러스터에서의 성능 측정·공인 인증서 배포 확인을 대신하지 않습니다.

큐 신규 유입이 0이 되어 k6가 먼저 끝나더라도 기본 총 941초의 계획 관측 구간까지 서버 감시를 유지합니다(기간을 변경하면 해당 설정 합계 적용). 이때 추가 HTTP 부하는 발생시키지 않으며, 회복 구간의 큐 깊이도 최종 수집 범위에 포함합니다.
