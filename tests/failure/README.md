# Ticketing 장애 시험 실행 디렉터리

이 디렉터리는 Ansible Controller에서 사용하는 실행 파일이다. 전체 설명은 배포 ZIP 최상위의 `README.md`를 기준으로 한다.

## 안전 원칙

- 장애 시험은 반드시 하나씩 실행한다.
- 한 시험의 복구와 최종 검증이 끝나기 전에 다음 시험을 시작하지 않는다.
- `playbooks/run_all.yml`은 안전을 위해 항상 중단된다.
- Data Worker 장애와 Master 2대 동시 장애는 이 패키지의 범위가 아니다.

## 최초 준비

```bash
cd tests/failure
cp inventory.example.ini inventory.ini
scripts/00_setup.sh
scripts/01_precheck.sh
```

두 명령 중 하나라도 실패하면 장애 시험을 시작하지 않는다.

## 개별 실행

```bash
CONFIRM_DISRUPTIVE_TESTS=YES scripts/10_pod_autohealing.sh
CONFIRM_DISRUPTIVE_TESTS=YES scripts/20_worker_failure.sh
CONFIRM_DISRUPTIVE_TESTS=YES scripts/30_master_failure.sh
CONFIRM_DISRUPTIVE_TESTS=YES scripts/40_lb_failure.sh
CONFIRM_DISRUPTIVE_TESTS=YES scripts/50_redis_failover.sh
CONFIRM_DISRUPTIVE_TESTS=YES scripts/60_postgresql_failover.sh
CONFIRM_DISRUPTIVE_TESTS=YES scripts/70_kafka_failure.sh
```

각 명령 뒤에 `results/<TEST_ID>/final-report.md`와 `result.json`을 확인한다.

동일 회차의 k6 결과와 연결하려면 두 터미널에 같은 `TEST_ID`를 지정한다.

```bash
TEST_ID=N-01-20260909-01 CONFIRM_DISRUPTIVE_TESTS=YES \
  scripts/20_worker_failure.sh -e worker_failure_target=w2
```

## 긴급 복구

```bash
TEST_ID='<실패한-TEST_ID>' scripts/99_recovery.sh
```

복구 스크립트가 성공한 뒤에도 `kubectl get nodes`, `kubectl get pod -A`, 데이터 서비스 상태를 직접 확인한다.

## Grafana

`grafana/failure-tests-dashboard.json`을 Import한다. Grafana 캡처와 Loki 로그 저장은 수동이며, 정밀 시간은 `result.json`, Probe 또는 k6 결과를 사용한다.
