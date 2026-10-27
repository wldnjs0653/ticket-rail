# TicketRail

**Kubernetes 기반 티켓 예매 서비스 구축과 하이브리드 클라우드 확장**

TicketRail은 대기열, 좌석 선점, 예약과 비동기 결제·알림으로 구성한 티켓 예매 서비스입니다. 1차 프로젝트에서 온프레미스 고가용성 인프라를 구축하고, 2차 프로젝트에서 처리 병목을 개선하며 클라우드로 확장했습니다.

## 프로젝트 둘러보기

| 구분 | 1차 프로젝트 | 2차 프로젝트 |
| --- | --- | --- |
| 주제 | 대용량 티켓 예매 인프라 구축 | 하이브리드 클라우드 확장 및 성능 검증 |
| 기간 | 2026.08.25 ~ 2026.09.23 | 2026.09.28 ~ 2026.10.26 |
| 팀 인원 | 4명 | 2명 |
| 담당 역할 | 팀장, 논리 아키텍처 설계, 시험 계획과 통합 검증 | 팀장, 아키텍처 통합, Consumer 병목 분석과 성능·복구 개선 |
| 주요 환경 | 온프레미스 Kubernetes | 온프레미스 · 하이브리드 · Full AWS |
| 주요 검증 | 500 VU 대기열 시험, 좌석 동시성, HPA, 구성 요소 장애 대응 | 환경별 처리량, Kafka Lag, Redis·PostgreSQL 복구 개선 |
| 상세 보기 | [1차 프로젝트 소개](docs/first-project.md) | [2차 프로젝트 소개](docs/second-project.md) |

## 구현 코드와 실행 안내

이 저장소의 실행 코드와 기존 배포·시험 자료는 1차 프로젝트를 중심으로 구성되어 있습니다. 로컬 실행 방법과 상세 검증 내용은 [1차 프로젝트 문서](docs/first-project.md#로컬-실행)에서 확인할 수 있습니다.

2차 프로젝트의 공동 작업 소스에서는 Consumer 병렬 처리, 장애 대응 개선과 ROSA·KEDA 구성을 확인할 수 있습니다.

- [공동 저장소 main](https://github.com/jisoo9123/ticketing-project/tree/main): 성능 튜닝과 배포 점검이 통합된 기준 브랜치
- [최근 애플리케이션 변경 브랜치](https://github.com/jisoo9123/ticketing-project/tree/fix/payment-delay-confirmation-ui): main 이후 날짜 선택 및 결제 상태 화면 개선 포함
- [2차 프로젝트 소스 확인 안내](docs/second-project.md#구현-소스-안내): 코드 위치와 확인 범위

## 주요 기술

Linux · Kubernetes · Docker · AWS ROSA · Kafka · Redis · PostgreSQL · Ansible · Terraform · GitHub Actions · HPA · KEDA · Prometheus · Grafana · k6

결제와 알림은 모의 서비스로 구현하고 검증했습니다.
