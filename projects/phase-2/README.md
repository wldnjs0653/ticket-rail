# TicketRail ② 구현 소스

TicketRail의 2차 프로젝트 공동 작업 소스를 별도 폴더로 보관했습니다. 온프레미스 서비스의 Consumer 병렬 처리, Redis·PostgreSQL 장애 대응, ROSA 배포와 KEDA 자동 확장, 날짜별 열차 조회와 결제 상태 화면을 확인할 수 있습니다.

[프로젝트 소개](../../docs/second-project.md) · [전체 포트폴리오](../../README.md) · [1차 애플리케이션 코드](../../src) · [1차 배포 자료](../../k8s)

## 출처와 팀 기여

- 원본 저장소: [jisoo9123/ticketing-project](https://github.com/jisoo9123/ticketing-project)
- 가져온 브랜치: `fix/payment-delay-confirmation-ui`
- 기준 커밋: [`3a97332d37dad13485b9bcc450d84d0a5988526c`](https://github.com/jisoo9123/ticketing-project/commit/3a97332d37dad13485b9bcc450d84d0a5988526c)
- 해당 커밋 작성일: 2026.10.15
- 반영일: 2026.10.28

팀 공동 작업 결과물이며, 팀원의 저자 표기와 원본 코드 주석을 유지했습니다. 송지원의 담당은 프로젝트 진행 조율, 아키텍처 통합, Consumer 병목 분석과 성능·복구 개선, 시험 결과 정리입니다. 개인 기여의 상세 내용은 [2차 프로젝트 소개](../../docs/second-project.md#담당-업무)에 정리했습니다.

파일별 원본 경로, 체크섬과 제외한 백업 목록은 [SOURCE.json](SOURCE.json)에 기록했습니다. 이 폴더는 위 커밋의 스냅샷이며, 이후 공동 저장소 변경을 자동으로 가져오지는 않습니다.

## 코드 찾아보기

| 구분 | 파일과 폴더 |
| --- | --- |
| API와 애플리케이션 시작 | [src/server.js](src/server.js), [src/routes](src/routes) |
| 결제·알림 Consumer와 역할 분리 | [src/consumers](src/consumers) |
| Redis 장애 감지·재연결 | [redisClient.js](src/clients/redisClient.js) |
| PostgreSQL 연결·읽기 요청 재시도 | [pgClient.js](src/clients/pgClient.js) |
| 대기열의 원자적 처리 | [queueAdmission.js](src/services/queueAdmission.js) |
| 결제 상태 화면 | [payment-status.js](src/public/payment-status.js), [ticketing.html](src/public/ticketing.html) |
| 날짜별 열차 조회 | [dailyTrainCatalog.js](src/services/dailyTrainCatalog.js) |
| 온프레미스 Consumer·KEDA | [k8s_playbooks/app](k8s_playbooks/app) |
| ROSA Consumer·KEDA·애플리케이션 | [k8s_playbooks/rosa](k8s_playbooks/rosa) |
| PostgreSQL 장애 전환 구성 | [postgresql.yml](Data_Monitoring_playbooks/postgresql.yml) |
| PostgreSQL 복구 시험 스크립트 | [failure-tests/postgresql-rto](failure-tests/postgresql-rto) |
| 배포 자동화 | [ansible](ansible), [scripts](scripts) |
| 원본 CI/CD 구성 참고 | [ci-reference](ci-reference) |
| 자동 테스트 | [test](test) |

## 자동 테스트 실행

Node.js 20 이상과 npm을 준비하고 저장소 루트에서 실행합니다.

```bash
cd projects/phase-2
npm ci --ignore-scripts
npm test
```

2026년 10월 28일 이벤트 계약, 대기열, 날짜별 열차 조회, 결제 상태의 자동 테스트 29개가 통과했습니다. 이 검사는 실제 클러스터에서 수행한 부하·장애 시험과 별개입니다.

## 배포 자료 이용

[.env.example](.env.example)은 연결 정보와 비밀값을 채우는 예시입니다. 실제 실행에는 PostgreSQL·Redis·Kafka와 실행 환경에 맞는 설정이 필요합니다. Kubernetes 설정의 namespace, 주소와 이미지 경로도 대상 환경에 맞게 확인해야 합니다.

원본 `docker-compose.local.yml`은 현재 폴더에 없는 `src/db/schema.sql`을 참조합니다. 로컬 데이터베이스 초기화는 [src/db](src/db)의 제공된 스키마와 애플리케이션 요구 사항을 확인해 구성해야 합니다. 위 자동 테스트는 Docker Compose나 외부 데이터베이스 없이 실행됩니다.

원본 GitHub 배포 워크플로는 `ci-reference`에 텍스트로 보관했습니다. 포트폴리오용 자동 검사는 저장소의 `phase-2-ci.yml`이 담당하며, 실제 서버 배포나 이미지 게시를 실행하지 않습니다.

이 소스에 포함된 ROSA·하이브리드 구성과 최종보고서의 Full AWS 시험 자료는 범위가 다릅니다. Terraform 파일 및 Full AWS 최종 설정·부하 결과 원본은 이 브랜치에 포함되어 있지 않습니다.

## 원본 참고 문서

- [원본 README](UPSTREAM_README.md)
- [원본 개발 메모](UPSTREAM_NOTES.md)
- [60 rps 용량 설정](docs/sustainable-capacity.md)
- [대기열 설계](docs/waiting-room.md)

원본 메모는 작성 당시의 안내를 보존한 자료이며, 현재 실행 방법은 이 문서와 실제 소스 파일을 기준으로 확인합니다.
