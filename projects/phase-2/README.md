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

파일별 원본 경로, 체크섬과 제외한 백업 목록은 [SOURCE.json](SOURCE.json)에 기록했습니다. 애플리케이션과 배포 소스는 위 커밋의 스냅샷이며, 로컬 체험용 Compose·스키마·샘플 데이터·검증 스크립트는 포트폴리오에서 보완했습니다. 이후 공동 저장소 변경을 자동으로 가져오지는 않습니다.

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

## 로컬에서 예매 흐름 실행

Docker Engine 또는 Docker Desktop의 Linux 컨테이너와 Docker Compose v2.20 이상을 준비합니다. 아래 명령은 저장소 루트에서 시작하며, PowerShell과 Bash에서 동일하게 사용할 수 있습니다. Node.js를 PC에 별도로 설치하지 않아도 컨테이너 안에서 API와 Consumer가 실행됩니다.

```bash
cd projects/phase-2
docker compose -f docker-compose.local.yml config --quiet
docker compose -f docker-compose.local.yml up --build --wait --wait-timeout 240
```

브라우저에서 [로컬 예매 화면](http://localhost:3000/ticketing.html)을 엽니다. 날짜를 선택하면 열차·가격·좌석이 생성됩니다. 샘플 사용자 `id=1`로 대기열 입장, 좌석 선점, 예약, 모의 결제·알림 흐름을 체험할 수 있습니다. `preview=1` 옵션은 화면용 미리보기이므로 실제 API 확인 시 붙이지 않습니다.

```bash
# 실제 PostgreSQL·Redis·Kafka를 거치는 예매와 후속 처리 확인
docker compose -f docker-compose.local.yml exec -T app node local/smoke.js
# 서비스 종료 (예매 DB 보존)
docker compose -f docker-compose.local.yml down
```

검증 스크립트는 날짜별 열차 생성, 대기열·입장, 좌석 선점, 예약 저장, 같은 키의 예약 재요청, Kafka 결제 처리와 알림 완료 이력을 확인하며 성공 시 `PASS`를 출력합니다. 실행할 때마다 사용 가능한 좌석 1개를 예약합니다. 3000번 포트가 사용 중이면 Compose의 `TICKETRAIL_LOCAL_PORT` 환경변수를 다른 포트로 지정합니다.

### 초기화 자료와 데이터 보존

| 자료 | 역할 |
| --- | --- |
| [docker-compose.local.yml](docker-compose.local.yml) | 단일 Redis·PostgreSQL 16·Kafka 3.9.1과 API/Consumer 실행, 토픽 생성과 준비 상태 확인 |
| [src/db/schema.sql](src/db/schema.sql) | 7개 테이블·시퀀스·키 제약, 좌석 `price`·`grade` 포함 |
| [local/seed.sql](local/seed.sql) | 화면에서 사용하는 샘플 사용자 `id=1` 생성 |
| [local/smoke.js](local/smoke.js) | 실제 의존성을 연결한 예매→모의 결제→알림 검증 |
| [원본 Compose](local/docker-compose.upstream.yml.txt) | 가져온 원본 설정 보존 |

스키마는 [원본 스키마 덤프](src/db/ticketing-table-schema_2026-09-03.sql)를 기준으로 PostgreSQL 16에서 사용하도록 정리했습니다. 덤프 도구의 클라이언트 명령과 `transaction_timeout` 설정을 제외하고 테이블·컬럼·제약은 유지했습니다. PostgreSQL의 초기화 SQL은 **빈 데이터 볼륨에서 최초 기동할 때** 실행되며, 이후에는 기존 예매 데이터가 보존됩니다.

로컬 데모 데이터 전체를 지우고 새로 시작하려는 경우에만 아래 명령을 실행합니다. 해당 Compose 프로젝트의 PostgreSQL 볼륨이 삭제됩니다.

```bash
docker compose -f docker-compose.local.yml down --volumes
docker compose -f docker-compose.local.yml up --build --wait --wait-timeout 240
```

이 구성은 포트폴리오 기능 체험용 단일 노드 환경입니다. Redis Sentinel·CNPG 장애 전환, Kubernetes/ROSA 자동 확장과 성능 수치는 프로젝트의 별도 검증 환경을 기준으로 합니다. 결제·알림은 모의 처리이며 실제 청구나 메시지 발송은 없습니다. 앱은 `127.0.0.1`에만 공개하고, Redis·PostgreSQL·Kafka 포트는 PC 외부에 공개하지 않습니다.

Kafka 이미지와 단일 노드 설정은 [Apache Kafka 공식 Docker 안내](https://kafka.apache.org/39/getting-started/docker/)와 [공식 Compose 예제](https://github.com/apache/kafka/tree/3.9.1/docker/examples/docker-compose-files)를 참고했습니다.

## 클러스터 배포 자료 이용

[.env.example](.env.example)은 연결 정보와 비밀값을 채우는 예시입니다. 실제 실행에는 PostgreSQL·Redis·Kafka와 실행 환경에 맞는 설정이 필요합니다. Kubernetes 설정의 namespace, 주소와 이미지 경로도 대상 환경에 맞게 확인해야 합니다.

로컬 실행은 위 Compose 안내를 사용합니다. `UPSTREAM_README.md`와 과거 스키마는 원본 참고 자료이며, 현재 초기화 파일은 `src/db/schema.sql`과 `local/seed.sql`입니다. 위 단위 테스트는 외부 데이터베이스 없이 실행되고, `local-demo` 자동 검사는 Compose를 기동해 실제 의존성과 후속 처리를 검증합니다.

원본 GitHub 배포 워크플로는 `ci-reference`에 텍스트로 보관했습니다. 포트폴리오용 자동 검사는 저장소의 `phase-2-ci.yml`이 담당하며, 실제 서버 배포나 이미지 게시를 실행하지 않습니다.

이 소스에 포함된 ROSA·하이브리드 구성과 최종보고서의 Full AWS 시험 자료는 범위가 다릅니다. Terraform 파일 및 Full AWS 최종 설정·부하 결과 원본은 이 브랜치에 포함되어 있지 않습니다.

## 원본 참고 문서

- [원본 README](UPSTREAM_README.md)
- [원본 개발 메모](UPSTREAM_NOTES.md)
- [60 rps 용량 설정](docs/sustainable-capacity.md)
- [대기열 설계](docs/waiting-room.md)

원본 메모는 작성 당시의 안내를 보존한 자료이며, 현재 실행 방법은 이 문서와 실제 소스 파일을 기준으로 확인합니다.
