# TicketRail

온프레미스 Kubernetes에서 구축하고 클라우드로 확장한 열차 예매 서비스입니다.

[프로젝트 구성과 시연 영상](https://app.notion.com/p/TicketRail-40f7416fb05f81e4bdfaeedf3dcbaebb?pvs=12)

## 프로젝트와 소스 코드

| 프로젝트 | 소스 코드 |
| --- | --- |
| [1차 · 온프레미스 구축](docs/first-project.md) | [예매 서비스](src) · [Kubernetes](k8s) · [CI/CD](.github/workflows/ci.yml) |
| [2차 · 클라우드 확장](docs/second-project.md) | [결제·알림 Consumer](projects/phase-2/src/consumers) · [배포·검증 코드](projects/phase-2/README.md#코드-찾아보기) |

## 로컬 데모

### 1. HTML 미리보기 · 설치 없이 체험

샘플 데이터로 열차 조회부터 결제 완료 화면까지 체험할 수 있습니다.

1. [미리보기 전용 ZIP 다운로드](https://github.com/wldnjs0653/ticket-rail/releases/download/html-preview-v1/TicketRail-preview.zip) 후 압축을 풉니다.
2. 압축을 푼 폴더에서 **`preview.html`**을 더블클릭합니다.

### 2. Docker Compose · 서비스 연동 확인

API와 Redis·PostgreSQL·Kafka를 함께 실행합니다. Docker Compose v2.20 이상과 Linux 컨테이너 환경이 필요합니다.

```sh
git clone https://github.com/wldnjs0653/ticket-rail.git
cd ticket-rail/projects/phase-2
docker compose -f docker-compose.local.yml up --build --wait --wait-timeout 240
```

1. [예매 화면](http://localhost:3000/ticketing.html)을 열고 열차와 좌석을 선택해 예매합니다.
2. 예매 결과 화면에서 **처리 기록 보기**를 누릅니다.

처리 기록에는 같은 예약 번호로 다음 단계의 처리 시각이 표시됩니다.

- **Redis** · 선택한 좌석의 선점과 해제
- **PostgreSQL** · 예약 저장
- **Kafka** · 이벤트 발행과 결제·알림 Consumer 처리

결제와 알림은 모의 처리입니다. [자동 검증과 종료 방법](projects/phase-2/README.md#로컬에서-예매-흐름-실행)
