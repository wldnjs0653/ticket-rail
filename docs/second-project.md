# 열차 예매 서비스의 클라우드 확장과 성능 검증

온프레미스 환경의 처리 병목과 장애 복구를 개선하고, 하이브리드와 Full AWS 환경으로 확장해 예매 흐름을 검증했습니다.

[프로젝트 상세](https://app.notion.com/p/TicketRail-40f7416fb05f81e4bdfaeedf3dcbaebb?pvs=12)

## 인프라 구축 자료

| 항목 | 확인할 내용 | 바로가기 |
|---|---|:---:|
| **온프레미스 구성** | API·Consumer 배포와 KEDA 자동 확장 설정 | [보기](../projects/phase-2/k8s_playbooks/app) |
| **하이브리드 구성** | AWS ROSA의 Consumer 배포와 KEDA 자동 확장 설정 | [보기](../projects/phase-2/k8s_playbooks/rosa) |
| **Full AWS 구성** | ROSA, ElastiCache for Valkey, RDS, MSK 인프라 | 보기 |

환경별 처리 흐름과 시험 결과는 상단의 **프로젝트 상세**에서 확인할 수 있습니다.

## 구현 및 검증 코드

| 항목 | 확인할 내용 | 바로가기 |
|---|---|:---:|
| **Consumer 성능 개선** | 결제·알림 Consumer의 병렬 처리 코드 | [보기](../projects/phase-2/src/consumers) |
| **Redis 장애 복구** | Primary 변경 감지와 연결 갱신 | [보기](../projects/phase-2/src/clients/redisClient.js) |
| **PostgreSQL 장애 검증** | Primary 전환과 조회 동작을 확인하는 시험 스크립트 | [보기](../projects/phase-2/failure-tests/postgresql-rto) |
| **예매 흐름 검증** | 예매부터 결제·알림까지 확인하는 로컬 검증 스크립트 | [보기](../projects/phase-2/local/smoke.js) |
| **자동 검증** | GitHub Actions에서 코드 검사와 로컬 예매 흐름을 검증하는 설정 | [보기](../.github/workflows/phase-2-ci.yml) |

[첫 화면](../README.md)
