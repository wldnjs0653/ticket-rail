# TicketRail

Kubernetes 기반 열차 예매 서비스의 소스 코드와 배포 구성입니다.

[구성 설명과 시연 영상](https://app.notion.com/p/TicketRail-40f7416fb05f81e4bdfaeedf3dcbaebb?pvs=12)

## 소스 코드

| 프로젝트 | 소스 코드 |
| --- | --- |
| [1차 · 온프레미스 구축](docs/first-project.md) | [예매 서비스](src) · [Kubernetes](k8s) · [CI/CD](.github/workflows/ci.yml) |
| [2차 · 클라우드 확장](docs/second-project.md) | [결제·알림 Consumer](projects/phase-2/src/consumers) · [배포·검증 코드](projects/phase-2/README.md#코드-찾아보기) |

## 로컬 데모

### 1. HTML 미리보기

별도 설치 없이 브라우저에서 샘플 데이터로 예매 화면을 체험할 수 있습니다.

[저장소 ZIP 다운로드](https://github.com/wldnjs0653/ticket-rail/archive/refs/heads/main.zip) 후 압축을 풀고, `projects/phase-2/src/public/ticketing.html`을 더블클릭하세요. 체험을 마치면 탭을 닫으면 됩니다.

### 2. Docker Compose로 실행

API·PostgreSQL·Redis·Kafka가 연결된 예매 흐름을 확인할 수 있습니다. Docker Compose v2.20 이상과 Linux 컨테이너 환경이 필요합니다.

```sh
git clone https://github.com/wldnjs0653/ticket-rail.git
cd ticket-rail/projects/phase-2
docker compose -f docker-compose.local.yml up --build --wait --wait-timeout 240
```

[예매 화면 열기](http://localhost:3000/ticketing.html) · [데모 사용·검증·종료 방법](projects/phase-2/README.md#로컬에서-예매-흐름-실행)

예매 완료 화면에서 **처리 기록 보기**를 누르면 같은 예약의 Redis 좌석 선점·해제, PostgreSQL 예약 저장, Kafka 발행과 결제·알림 Consumer 처리 시각을 볼 수 있습니다.
