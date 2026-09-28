# 패키지 검증 기록

검증일: 2026-09-15. 이 문서는 자동화 코드의 개발 검증 기록이며 프로젝트의 실제 동시성 시험 결과가 아니다.

## 사용 도구

- ansible-core 2.16.14
- k6 2.2.0, commit `00a9a1b7f5`
- Node.js 24.19.0: 개발용 모의 서버·테스트 도구에만 사용

## 확인한 결과

| 검증 | 결과 |
|---|---|
| Ansible playbook syntax-check | 통과 |
| 실제 JS + 모의 HTTP: 선점 성공 1·충돌 4·예약 1·요청 겹침·DB 완료 | PASS, 공통 요청 구간 46ms |
| 요청 구간이 겹치지 않지만 API·DB가 맞는 경우 | INCONCLUSIVE, 공통 요청 구간 0ms |
| 여러 사용자에게 선점 성공을 반환하는 잘못된 API | FAIL |
| 결제 상태가 PENDING으로 남아 있는 DB 응답 | FAIL |
| 사전에 BOOKED 상태인 좌석 | ERROR, k6 실행 전 차단 |
| 실제 k6 + Ansible + 로컬 HTTPS 서버 | PASS, 선점 5회·예약 1회, 공통 요청 구간 104ms |

로컬 HTTPS 검증에서는 임시 CA를 `SSL_CERT_FILE`로 전달하고 TLS 검증을 활성화했다. 의도적으로 Hold 응답을 100ms 지연한 모의 서버를 사용했다. 104ms는 해당 검증 환경의 값이며 실제 프로젝트의 성능 수치가 아니다. k6의 실제 로그 형식을 Ansible이 읽고 CSV·보고서·결과 JSON을 생성하는 경로까지 실행했다.

Kubernetes와 PostgreSQL 응답은 개발용 대체 프로그램을 사용했다. 프로젝트 클러스터의 접근 권한, 스키마, 사용자·좌석 상태, 실서비스의 입장/선점/결제 동작, Prometheus remote write 전달은 이 검증으로 확인한 것이 아니다. 실제 SQL은 기존에 사용자 측에서 직접 조회한 public.booking, public.booking_seat, public.seat, public.payment 컬럼을 기준으로 작성했다.

실제 시험은 `vars/concurrency.yml`에 새 빈 좌석과 사용자 5명을 지정한 후 ansible-controller에서 실행해야 한다. 성공·미확인·실패 모두 원자료가 생성되도록 설계했으며, 검증용 가짜 응답은 일반 실행 경로에서 사용되지 않는다.
