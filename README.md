# TicketRail | 인프라·클라우드 포트폴리오

**Kubernetes 고가용성 인프라 구축 → Consumer 병목 개선 → 클라우드 확장**

대기열·좌석 선점·예약과 Kafka 기반 모의 결제·알림을 처리하는 티켓 예매 서비스입니다. 두 차례 팀장을 맡아 아키텍처 설계, 시험과 시스템 통합 검증을 수행했습니다.

## 프로젝트 한눈에 보기

| 구분 | ① 인프라 구축 | ② 확장·성능 개선 |
| --- | --- | --- |
| 기간·팀 | 2026.08.25 ~ 09.23 · 4명 | 2026.09.28 ~ 10.26 · 2명 |
| 환경 | 온프레미스 Kubernetes | 온프레미스 · 하이브리드 · Full AWS |
| 개인 담당 | 논리 설계 · 시험 계획 · 통합 검증 | Consumer 튜닝 · 성능·복구 개선 · 통합 |
| 주요 성과 | 대기열 **500 VU** 검증<br>HPA **2 → 6 → 2개** | 예매 흐름(건/초)<br>**온프레미스 31 · 하이브리드 60 · Full AWS 80** |
| 상세 보기 | [1차 프로젝트](docs/first-project.md) | [2차 프로젝트](docs/second-project.md) |
| 코드·실행 | [애플리케이션](src) · [배포 구성](k8s) | [2차 코드·로컬 체험](projects/phase-2/README.md) |

2차 장애 비교 시험에서는 Redis **API 복구 약 33 → 7초**, PostgreSQL **Primary 전환 약 183 → 33초**를 확인했습니다.

<details>
<summary><strong>기술·구현 자료 더 보기</strong></summary>

- **구성과 성과:** [1차 상세](docs/first-project.md) · [2차 상세](docs/second-project.md)
- **1차 구현:** [src](src) · [k8s](k8s) · [ansible](ansible) · [시험 자료](tests)
- **2차 구현:** [소스·실행·출처](projects/phase-2/README.md) · [원본 공동 저장소](https://github.com/jisoo9123/ticketing-project)

기술: **Linux · Kubernetes · AWS ROSA · Redis · PostgreSQL · Kafka · Ansible · Terraform · GitHub Actions · HPA/KEDA · Prometheus/Grafana · k6**

세부 기술과 팀·개인 기여는 각 프로젝트 문서에 정리했습니다. 결제·알림은 모의 서비스로 검증했습니다.

</details>
