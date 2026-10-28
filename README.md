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
| 소스 보기 | [애플리케이션](src) · [배포 구성](k8s) · [시험](tests) | [2차 소스와 실행 안내](projects/phase-2) |

## 구현 코드와 실행 안내

1차 프로젝트 코드는 저장소 루트의 `src`, `k8s`, `ansible`, `services`, `tests`에 있습니다. [1차 프로젝트 문서](docs/first-project.md#로컬-실행)에 실행 방법과 상세 검증을 정리했습니다.

2차 프로젝트 코드는 [`projects/phase-2`](projects/phase-2)에 별도로 보관했습니다. [원본 공동 저장소의 특정 커밋](https://github.com/jisoo9123/ticketing-project/commit/3a97332d37dad13485b9bcc450d84d0a5988526c)을 기준으로 가져왔으며, Consumer 병렬 처리, 장애 대응 개선과 ROSA·KEDA 구성을 포함합니다. 출처와 테스트 방법은 [2차 소스 안내](projects/phase-2/README.md)에서 확인할 수 있습니다.

## 주요 기술

Linux · Kubernetes · Docker · AWS ROSA · Kafka · Redis · PostgreSQL · Ansible · Terraform · GitHub Actions · HPA · KEDA · Prometheus · Grafana · k6

결제와 알림은 모의 서비스로 구현하고 검증했습니다.
