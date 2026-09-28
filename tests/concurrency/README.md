# 동일 좌석 동시성 자동화 — Ansible + k6

서로 다른 사용자 5명이 같은 좌석에 선점 요청을 보내고, 선점 성공자만 예약한다. 요청 시간의 겹침과 DB의 예약·좌석·결제 결과를 함께 남긴다. 기존 v1.5 패키지와 별개 폴더에서 실행하는 동시성 전용 패키지다.

## 무엇이 어떤 일을 하는가

| 구성 | 역할 |
|---|---|
| `concurrency.yml` | 입력 검사, 빈 좌석 DB 확인, k6 실행, 오류 처리, 최종 결과 저장 |
| `k6/seat-concurrency.js` | 큐 입장 준비, 공통 출발 시각, 5 VU 선점 요청, 승자 예약, 사용자별 시간 기록 |
| `tasks/k6.yml` | k6를 직접 실행하고 기록을 Ansible 필터로 해석, 요청 겹침 계산 |
| `tasks/primary.yml` | CNPG 현재 Primary를 kubectl로 조회 |
| `tasks/db_poll.yml` | 비동기 결제가 끝날 때까지 DB를 반복 조회하고 각 관측 보관 |
| `templates/*.sql.j2` | PostgreSQL에서 실행할 읽기 전용 SQL |
| `templates/report.md.j2` | 원자료를 근거로 Ansible이 만드는 보고서 |

실행 진입점은 `ansible-playbook`이다. Bash 실행 래퍼와 사용자 정의 Python 자동화·분석 스크립트는 없다. Ansible 자체가 사용하는 Python 런타임은 필요하지만, 기존 `auto.py`, `reporting.py`, `database.py`는 호출하지 않는다. Kubernetes Python 패키지도 필요 없다.

## 실행 준비

기존 ansible-controller에서 실행한다. `ansible-playbook`(ansible-core 2.16 이상), `k6`(검증 버전 2.2.0), `kubectl`이 PATH에 있어야 한다. kubectl context는 대상 프로젝트 클러스터를 가리켜야 한다. 현재 Primary의 postgres 컨테이너에 psql이 있어야 한다.

저장소 루트에서 다음과 같이 예시 설정을 복사합니다.

```bash
cd tests/concurrency
cp inventory.example.ini inventory.ini
cp vars/concurrency.example.yml vars/concurrency.yml
vi vars/concurrency.yml
```

아래 세 값을 실제 데이터로 지정한다. 사용자 5명은 서로 다른 실제 사용자여야 한다. 좌석은 해당 이벤트의 빈 좌석이어야 하며, 기존 E2E에서 사용한 BOOKED 좌석 8은 재사용하지 않는다.

```yaml
event_id: 1
seat_id: null   # 실제 빈 좌석 ID로 변경
user_ids: []    # 실제 사용자 ID 5개를 YAML 리스트로 입력
```

기본 URL은 `https://api.nammer.store`다. 도메인 해석·접속이 가능한지 확인한다. 내부 CA 주소를 사용한다면 `base_url`을 바꾸고 `tls_ca_file`에 신뢰할 CA PEM 경로를 입력한다. TLS 검증은 계속 활성화한다.

기본 좌석 상태는 `AVAILABLE`이다. 실제 DB의 빈 좌석 상태 문자열이 다르면 `available_seat_status`를 맞춘다. 사전 SQL은 DB상 빈 좌석 여부를 확인하며, Redis의 남아 있는 Hold를 직접 조회하지는 않는다. 다른 시험과 같은 좌석을 공유하지 않는다.

## 실행

```bash
ansible-playbook -i inventory.ini concurrency.yml --syntax-check
ansible-playbook -i inventory.ini concurrency.yml
```

두 번째 명령이 실제 큐 등록·선점·예약을 수행한다. 실행하면 새 예약과 결제 행이 생길 수 있다. 기본 재실행·데이터 삭제·DB 상태 초기화는 없다. 재시험은 다른 빈 좌석을 명시해서 실행한다. `--check`는 지원하지 않는다.

## 실행 순서

1. HTTPS 주소·사용자 5명·좌석 ID와 도구를 검사한다.
2. 고유 결과 폴더를 만들고 적용 설정과 소스 사본을 저장한다.
3. CNPG 현재 Primary에 읽기 전용 SQL을 실행한다. 대상 이벤트의 빈 좌석이며 예약 연결이 0건이어야 진행한다.
4. Ansible이 `command` 모듈로 k6를 직접 실행한다. 최대 480초 동안 상태를 확인한다.
5. k6 `setup()`에서 사용자마다 `queue/join`과 `auth/verify`를 수행한다. 대기 응답이면 기본 5초마다 확인하며, 사용자당 최대 60초 기다린다. 마지막에 5명의 입장 상태를 다시 확인한다. 이 재확인은 입장 TTL 갱신을 전제로 하지 않는다.
6. 공통 출발 시각을 기본 3초 뒤로 정한다. 5 VU가 그 시각을 기다렸다가 각각 동일 좌석에 Hold 1회씩 요청한다. 별도 배리어 서버를 사용하는 방식은 아니며, 늦게 시작한 VU는 사후 시각 검사에서 식별한다.
7. 선점에 성공한 사용자만 예약을 1회 요청한다. 사용자별로 서로 다른 Idempotency-Key를 사용한다.
8. Ansible이 k6 로그에서 요청 시작·종료 시각과 결과를 읽고 API 결과와 시간 겹침을 별도 계산한다.
9. 예약 ID 1개가 정상 반환되면 DB를 조회한다. 기본 최대 24회, 실패한 조회 사이 5초 대기하며 결제 처리를 확인한다. 쿼리 소요시간은 추가된다. 매번 현재 Primary를 다시 조회한다.
10. `result.json`과 `report.md`를 저장한다. PASS 이외에는 결과를 남긴 뒤 Ansible이 실패 종료한다.

## 확인 기준

| 검사 | 기준 |
|---|---|
| API | 선점 200 1건, 선점 409 4건, 예약 201 1건, 예약 사용자가 선점 승자와 일치, k6 종료 0 |
| 사용자·좌석 | 요청한 5명 각각 1건, 동일 좌석 ID |
| 공통 요청 구간 | 가장 이른 응답 완료 시각 − 가장 늦은 요청 시작 시각 > 0 |
| 출발 정렬 | 모든 VU가 동일 목표 시각을 사용하고 목표 이전에 요청하지 않으며 출발 지연이 기본 100ms 이하 |
| DB 예약 | 반환된 Booking ID 1건, 승자 User·Event 일치, CONFIRMED |
| DB 좌석 | Booking의 좌석 연결 1건이며 대상 좌석 일치, 대상 좌석의 전체 예약 연결도 1건, Event 일치 및 BOOKED |
| DB 결제 | 해당 Booking의 Payment 1건, APPROVED 및 processed_at 존재 |

100ms는 서비스 응답시간 합격 기준이 아니라 요청 출발 정렬을 확인하기 위한 조정 가능한 시험 설정이다. 밀리초 단위 관측으로 겹침이 보이지 않으면 동시성이 없었다고 단정하지 않고 미확인으로 처리한다.

`PASS`는 API·클라이언트 시간 조건·DB가 모두 충족된 경우다. API와 DB는 충족했지만 시간 조건이 충족되지 않으면 `INCONCLUSIVE`다. API/DB 조건 미충족은 `FAIL`, 실행·수집·파싱 실패는 `ERROR`다. DB 조회 실패의 원인은 `db-history.json`에 보존하므로 조건 미확인을 곧바로 애플리케이션 결함으로 해석하지 않는다.

## 결과 확인과 캡처

실행 마지막에 출력되는 `results/<Run ID>/` 아래에서 확인한다.

| 파일 | 확인할 근거 |
|---|---|
| `events.log` | k6가 직접 남긴 각 사용자·좌석·요청 시간·응답 상태·Booking ID |
| `requests.csv` | 같은 원자료를 정렬한 표 |
| `verify.sql` | 실제 DB에서 실행한 조회문 |
| `db-history.json` | 각 DB 조회의 원출력·행·시각·오류 |
| `k6-execution.json`, `console.log` | k6 종료 코드와 stdout/stderr |
| `points.json`, `summary.json` | k6 원시 지표와 요약 |
| `settings.json`, `source/` | 실제 적용값과 실행 소스 |
| `result.json`, `report.md` | 위 자료를 정리한 결과 |

`events.log`에서 선점 요청 5건과 승자의 Booking ID를 확인하고, `verify.sql`의 조회를 DB에서 다시 실행하면 행을 직접 확인할 수 있다. 기록된 SQL은 읽기 전용이다. 원자료를 함께 보관한다.

기본 Prometheus remote write URL은 기존 `http://127.0.0.1:9090/api/v1/write`다. 포트포워딩 등 기존 접근 경로가 살아 있어야 한다. 연결하지 않을 때는 설정값을 빈 문자열로 둔다. 모든 k6 지표에 새 `run_id`를 붙이며 `hold_successes`, `hold_conflicts`, `booking_successes`를 제공한다. 대시보드 변경·설치는 이 패키지에 포함하지 않는다. 전달 완전성도 별도 확인 사항이다.

이 시나리오는 `setup()`의 큐 등록·입장 폴링·입장 재확인 요청까지 k6 전체 HTTP 수에 포함한다. 선점 수는 `phase=race`, `api=seat_hold` 또는 `events.log`의 `kind=hold`로 구분한다. Admission 토큰과 응답 본문은 자체 증거 로그에 저장하지 않는다.

## 측정 범위

공통 요청 구간은 k6의 HTTP 호출 직전부터 응답 직후까지이며 연결/TLS 처리도 포함될 수 있다. 서버 내부 잠금 경쟁 구간을 직접 측정하지 않는다. 같은 시각에 서버에 도착했다고 주장하지 않는다. 서버 내부 실행 순서가 필요한 경우에는 별도 로그/트레이스를 연결해야 한다.

이 시험은 사용자 5명의 선점 경쟁과 승자 예약을 확인한다. 5명이 예약 API까지 동시에 호출하는 시험, 최종 큐·HPA 통합 부하, 외부 결제·알림 중복 부작용 검증과는 범위가 다르다. 결제 금액은 관측값으로 저장하며 기대 금액 비교는 하지 않는다.

## 개발 검증 재현

`tests/`는 패키지 검증용이며 실제 시험에서 호출하지 않는다. Node.js가 있는 별도 개발 환경에서 실행할 수 있다.

```bash
node tests/run.mjs /절대경로/ansible-playbook
node tests/real-k6.mjs /절대경로/ansible-playbook /절대경로/k6
```

첫 명령은 실제 시나리오 JavaScript를 모의 k6/HTTP 객체로 실행하고 Ansible 판정 경로를 확인한다. 두 번째는 실제 k6와 로컬 HTTPS 서버를 사용한다. 두 검증의 Kubernetes·DB 응답은 모의 자료다. 프로젝트 클러스터에 접속하거나 실제 예매 데이터를 변경하지 않는다. 검증 결과와 한계는 `VALIDATION.md`에 기록한다.

참고: [Ansible command 모듈](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/command_module.html), [k6 per-VU iterations](https://grafana.com/docs/k6/latest/using-k6/scenarios/executors/per-vu-iterations/), [k6 사용자 정의 요약](https://grafana.com/docs/k6/latest/results-output/end-of-test/custom-summary/).
