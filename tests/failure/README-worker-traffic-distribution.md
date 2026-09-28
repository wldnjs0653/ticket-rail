# Application Worker 트래픽 재분배 시험

이 시험은 다음 항목을 자동으로 측정한다.

- 장애 전 w1, w2, w3의 요청 처리 비율
- w2 장애 중 w1, w3의 요청 처리 비율
- 장애 전, 장애 중, 복구 후의 성공률
- 각 구간의 p50, p95, p99, 최대 응답시간
- 장애 전환 전체 구간의 실패 요청과 연속 실패 구간
- w2가 Service Endpoint에서 자동으로 제거됐는지 여부

## 기본 시험 조건

- 구간별 시험 시간: 60초
- 요청률: 초당 20건
- 구간별 요청 수: 약 1,200건
- 정상 상태 기대 비율: w1, w2, w3 각각 33.3%
- 장애 상태 기대 비율: w1, w3 각각 50%, w2 0%
- 트래픽 분산 허용 오차: ±5%p
- 최소 성공률: 99%

정확히 33.3% 또는 50%가 나오는지를 검사하는 것이 아니라 충분한 표본에서 허용 오차 안에 들어오는지를 검사한다.

## 파일

- playbooks/worker_traffic_distribution.yml
- scripts/probe_distribution.py
- scripts/analyze_distribution.py
- 기존 templates/traffic-probe.yaml.j2 재사용

기존 Probe는 응답 본문에 다음 값을 반환한다.

~~~text
pod=failure-test-nginx-...
node=w1
~~~

분석기는 이 node 값을 사용해 각 Worker가 처리한 요청 수와 비율을 계산한다.

## 1차 시험: 자동 Endpoint 제거 확인

먼저 이 시험을 실행한다.

~~~bash
cd tests/failure

ansible-playbook   playbooks/worker_traffic_distribution.yml   -e confirm_disruptive_tests=YES
~~~

기본 모드는 endpoint_failure_mode=auto이다.

이 모드에서는 w2의 kubelet과 containerd를 중지한 후 Kubernetes가 w2 Probe를 Service Endpoint에서 자동으로 제거하는지 기다린다. 제한 시간 안에 제거되지 않으면 시험을 실패로 종료하고 w2 서비스를 자동 복구한다.

이 실패는 Playbook 오류가 아니라 현재 장애 주입 방식으로는 실행 중인 컨테이너와 Endpoint가 실제로 제거되지 않았다는 시험 결과다.

## 2차 시험: Service 분산 동작 확인

1차 시험에서 w2 Endpoint가 자동으로 제거되지 않았지만 w1과 w3의 50:50 분산 자체를 확인하려면 다음과 같이 실행한다.

~~~bash
ansible-playbook   playbooks/worker_traffic_distribution.yml   -e confirm_disruptive_tests=YES   -e endpoint_failure_mode=force_probe
~~~

force_probe 모드는 w2가 NotReady가 된 후 격리된 시험용 NGINX Pod만 강제로 삭제한다. 실제 애플리케이션 Pod나 데이터는 삭제하지 않는다.

이 모드의 결과는 Service Endpoint가 2개로 줄어든 이후의 분산 동작을 검증한다. 물리 서버 전원 장애나 자동 Endpoint 제거 자체를 증명하는 결과로 사용하면 안 된다.

## 다른 Worker 시험

~~~bash
ansible-playbook   playbooks/worker_traffic_distribution.yml   -e confirm_disruptive_tests=YES   -e worker_failure_target=w3
~~~

## 시험 강도 변경

5분 동안 초당 50건을 보내고 최소 성공률을 99.9%로 검사하는 예시다.

~~~bash
ansible-playbook   playbooks/worker_traffic_distribution.yml   -e confirm_disruptive_tests=YES   -e traffic_phase_duration_seconds=300   -e traffic_requests_per_second=50   -e traffic_concurrency=100   -e minimum_success_rate_percent=99.9
~~~

## 결과 위치

~~~text
tests/failure/results/worker-traffic-YYYYMMDD-HHMMSS/
├── worker-traffic-report.md
├── worker-traffic-result.json
├── traffic-before.jsonl
├── traffic-during.jsonl
├── traffic-after.jsonl
├── traffic-transition.jsonl
├── endpoints-before.txt
├── endpoints-during.txt
└── endpoints-after.txt
~~~

worker-traffic-report.md에 다음 표가 생성된다.

| 구간 | 요청 | 성공률 | w1 | w2 | w3 | p50 | p95 | p99 | 최대 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 장애 전 | 측정값 | 측정값 | 측정값 | 측정값 | 측정값 | 측정값 | 측정값 | 측정값 | 측정값 |
| 장애 중 | 측정값 | 측정값 | 측정값 | 측정값 | 측정값 | 측정값 | 측정값 | 측정값 | 측정값 |
| 복구 후 | 측정값 | 측정값 | 측정값 | 측정값 | 측정값 | 측정값 | 측정값 | 측정값 | 측정값 |

## 안전장치

- confirm_disruptive_tests=YES 없이는 실행되지 않는다.
- 시험 대상은 기본적으로 w2이다.
- 시험 전 w1, w2, w3가 모두 Ready인지 확인한다.
- 장애시험 종료 또는 중간 실패 시 containerd와 kubelet을 다시 시작한다.
- 시험 대상 Worker를 uncordon한다.
- 기본적으로 시험용 Namespace를 종료 시 삭제한다.
- 실제 예약, 결제 데이터는 생성하거나 수정하지 않는다.

## 긴급 복구

~~~bash
cd tests/failure
ansible-playbook playbooks/recover.yml
~~~
