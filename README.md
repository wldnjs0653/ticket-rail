# TicketRail

Kubernetes 기반 열차 예매 서비스의 소스 코드와 배포 구성입니다.

[구성 설명과 시연 영상](https://app.notion.com/p/TicketRail-40f7416fb05f81e4bdfaeedf3dcbaebb?pvs=12)

## 소스 코드

| 프로젝트 | 소스 코드 |
| --- | --- |
| [1차 · 온프레미스 구축](docs/first-project.md) | [예매 서비스](src) · [Kubernetes](k8s) · [CI/CD](.github/workflows/ci.yml) |
| [2차 · 클라우드 확장](docs/second-project.md) | [결제·알림 Consumer](projects/phase-2/src/consumers) · [배포·검증 코드](projects/phase-2/README.md#코드-찾아보기) |

## 로컬 데모

Docker Compose v2.20 이상과 Linux 컨테이너 환경이 필요합니다.

```sh
git clone https://github.com/wldnjs0653/ticket-rail.git
cd ticket-rail/projects/phase-2
docker compose -f docker-compose.local.yml up --build --wait --wait-timeout 240
```

[예매 화면 열기](http://localhost:3000/ticketing.html) · [데모 사용·검증·종료 방법](projects/phase-2/README.md#로컬에서-예매-흐름-실행)
