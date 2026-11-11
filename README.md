# TicketRail

Kubernetes 기반 열차 예매 서비스의 애플리케이션, 인프라, 시험 코드입니다.

[구성 설명과 시연 영상](https://app.notion.com/p/TicketRail-40f7416fb05f81e4bdfaeedf3dcbaebb?pvs=12)

## 소스 코드

| 구분 | 코드와 문서 |
| --- | --- |
| 1차 서비스 | [예매 API와 화면](src) · [결제·알림 서비스](services/async-processing) |
| 1차 인프라 | [Kubernetes 배포 구성](k8s) · [Ansible 자동화](ansible) |
| 2차 서비스 | [2차 소스 및 실행 안내](projects/phase-2/README.md) · [결제·알림 Consumer](projects/phase-2/src/consumers) |
| 2차 배포 | [온프레미스 구성](projects/phase-2/k8s_playbooks/app) · [ROSA 구성](projects/phase-2/k8s_playbooks/rosa) |

2차 배포 코드는 온프레미스와 ROSA 구성을 포함합니다. [Full AWS 시험 자료의 범위](projects/phase-2/README.md#코드-찾아보기)를 참고하세요.

### 주요 구현 파일

- **CI/CD** — [GitHub Actions 워크플로](.github/workflows/ci.yml) · [Ansible 배포 플레이북](ansible/deploy/backend.yml)
- **Consumer 처리** — [결제 Consumer](projects/phase-2/src/consumers/paymentConsumer.js) · [온프레미스 KEDA 설정](projects/phase-2/k8s_playbooks/app/consumer-keda.yaml)
- **장애 대응** — [Redis 연결 갱신](projects/phase-2/src/clients/redisClient.js) · [PostgreSQL 재시도](projects/phase-2/src/clients/pgClient.js)
- **E2E 부하 시험** — [1차 k6 시나리오](tests/load/k6/scenarios/e2e.js)

## 로컬에서 실행

Docker Engine 또는 Docker Desktop의 Linux 컨테이너와 Docker Compose v2.20 이상이 필요합니다.

```sh
git clone https://github.com/wldnjs0653/ticket-rail.git
cd ticket-rail/projects/phase-2
docker compose -f docker-compose.local.yml up --build --wait --wait-timeout 240
```

[예매 화면](http://localhost:3000/ticketing.html)을 열거나, 다음 명령으로 예매 흐름을 확인합니다. 로컬 데모의 결제와 알림은 모의 서비스가 처리합니다.

```sh
docker compose -f docker-compose.local.yml exec -T app node local/smoke.js
```

체험을 마치면 다음 명령으로 종료합니다.

```sh
docker compose -f docker-compose.local.yml down
```

[샘플 데이터와 실행 옵션](projects/phase-2/README.md#로컬에서-예매-흐름-실행) · [GitHub Actions 실행 결과](https://github.com/wldnjs0653/ticket-rail/actions/runs/40608744575)

## 상세 문서와 출처

[1차 프로젝트](docs/first-project.md) · [2차 프로젝트](docs/second-project.md) · [2차 공동 작업 출처와 반영 범위](projects/phase-2/SOURCE.json)
