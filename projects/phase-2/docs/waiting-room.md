# Redis 대기실 운영 가이드

## 구현 결과

사용자가 열차를 선택하면 다음 흐름이 자동으로 실행됩니다.

1. `POST /queue/join`이 고유 대기 토큰과 최초 순번을 발급합니다.
2. 브라우저가 `POST /auth/verify`를 주기적으로 호출합니다.
3. 정원이 가득 찬 동안 API는 `202 waiting`과 현재 대기순번을 반환합니다.
4. 순서와 빈자리가 모두 충족되면 `200 admitted`를 반환하고 좌석 선택 화면으로 자동 이동합니다.
5. 사용자가 대기를 취소하거나 예약을 확정하면 점유한 입장 슬롯을 즉시 반환합니다.

대기 토큰은 `sessionStorage`에 보관하므로 같은 탭을 새로고침해도 순번을 복원합니다. 브라우저가 비정상 종료된 경우 Redis TTL이 토큰과 입장 슬롯을 최종 정리합니다.

## 동시성 안전성

입장 인원 확인, FIFO 순번 확인, 입장자 등록은 Redis Lua 스크립트 하나에서 원자적으로 처리됩니다. Backend Pod가 여러 개여도 `QUEUE_ADMISSION_LIMIT` 초과 입장과 뒤 순번의 선입장을 방지합니다.

## 설정값

| 환경변수 | 기본값 | 용도 |
|---|---:|---|
| `QUEUE_ADMISSION_LIMIT` | `200` | 동시에 좌석 선택 단계에 입장 가능한 사용자 수 |
| `ADMISSION_TTL_SECONDS` | `600` | 입장 권한 유지 시간 |
| `QUEUE_TOKEN_TTL_SECONDS` | `3900` | 대기 토큰 최대 유효시간 |

세 환경에서 비교 시험을 할 때는 이 값을 동일하게 유지해야 Web/API 또는 Kafka/Consumer 확장 효과를 공정하게 비교할 수 있습니다.

## 자동 검증과 배포

`main` 브랜치에 변경을 반영하면 GitHub Actions가 다음 작업을 자동 수행합니다.

1. JavaScript 문법 검사와 단위 테스트
2. 컨테이너 이미지 빌드 및 GHCR 업로드
3. Self-hosted Runner에서 `ansible/deploy-backend.yml` 실행
4. Kubernetes 롤아웃 확인
5. 공개 readiness, 대기실 UI, `/queue/join` 계약 스모크 테스트
6. 하나라도 실패하면 직전 이미지로 자동 롤백

로컬 검증 명령은 `npm test`입니다. 운영 배포를 직접 실행해야 할 때만 아래 명령을 사용합니다.

```bash
ansible-playbook ansible/deploy-backend.yml \
  --extra-vars "backend_image=ghcr.io/<owner>/ticketing-api:sha-<commit>"
```

## 사용자에게 보이는 상태

- 대기 중: 현재 대기순번과 진행 막대를 간결하게 표시
- 입장 가능: 좌석 선택 화면으로 자동 이동
- 새로고침: 기존 토큰으로 순번 복원
- 대기 취소: Redis 대기열과 입장 점유 즉시 반환
- 토큰 만료: 열차를 다시 선택하도록 안내