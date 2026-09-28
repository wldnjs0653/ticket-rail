# 시험별 Grafana 대시보드

통합 대시보드는 전체 구조 설명과 최종 보고서용이고, 이 폴더의 JSON은 실제 장애 시험 실행용이다. 각 JSON은 네임스페이스·Pod 범위·기본 장애 대상이 고정되어 있어 시험 때 상단 변수를 바꾸지 않는다.

| 시험 | Import 파일 | 핵심 패널 |
|---|---|---|
| P-01 Pod Auto Healing | `01-p01-pod-autohealing.json` | 시험용 Pod Ready, Deployment 복제본, UID 교체 후 배치 Node |
| N-01 Application Worker | `02-n01-worker-failure.json` | W2 Ready, 시험용 Endpoint, Node별 Running Pod |
| C-01 Master | `03-c01-master-failure.json` | API Server up, etcd leader, API 요청률 |
| L-01 API LB | `04-l01-lb-failure.json` | API Server up, API 요청률, VIP owner(조건부) |
| D-01 Redis | `05-d01-redis-failover.json` | Redis Pod Ready, exporter 상태(조건부), 전환 로그 |
| D-02 PostgreSQL | `06-d02-postgresql-failover.json` | PostgreSQL Pod Ready, CNPG role(조건부), PVC, 전환 로그 |
| D-03 Kafka | `07-d03-kafka-failure.json` | Kafka Pod Ready, under-replicated partition(조건부), 전환 로그 |

## Import

Grafana에서 `Dashboards → New → Import`로 이동한 뒤 해당 JSON을 업로드한다. Prometheus 데이터소스를 선택한다. D-01~D-03은 Loki 데이터소스도 선택한다.

모든 대시보드의 시간대는 UTC, refresh는 5초, 기본 범위는 최근 30분이다. 시험 종료 후 캡처할 때는 장애 전후가 포함된 절대 시간 범위로 고정한다.

## 고정값

- P-01: `namespace="failure-test"`, Pod·Deployment `failure-test-nginx`
- N-01: `namespace="failure-test"`, Node `w2`, Endpoint `failure-test-nginx`
- L-01: API VIP `10.1.93.65`
- D-01~D-03: `namespace="data"`, 각 서비스 Pod만 표시

N-01의 실제 장애 대상을 W2가 아닌 다른 Application Worker로 바꾼 경우에는 `02-n01-worker-failure.json`의 PromQL `node=~"w2"` 두 곳을 실제 노드명으로 바꿔 다시 Import한다.

## 판정 주의

Grafana는 상태 전환을 보여주는 보조 증거다. 정확한 복구시간, 요청 실패 수와 오류율은 Ansible Probe 또는 k6 결과를 기준으로 기록한다. `조건부` 패널이 `No data`이면 정상 0으로 해석하지 않고, 자동화가 저장한 CLI 결과를 사용한다.

W2에는 Grafana가 있으므로 N-01 실행 중 UI가 잠시 끊길 수 있다. 실제 Prometheus 서버가 다른 노드에 있으면 시계열은 계속 저장되며 W2 복구 후 같은 시간 범위를 조회할 수 있다.
