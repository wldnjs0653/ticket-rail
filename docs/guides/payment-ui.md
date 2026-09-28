# 사용자 결제·예매 완료 화면 적용 안내

## 적용된 사용자 흐름

1. 사용자가 열차와 좌석을 선택하고 좌석을 선점한다.
2. **결제하기** 버튼을 누른다.
3. 결제 팝업에서 결제수단과 카드 옵션을 선택한다.
4. 결제 동의 후 결제를 진행한다.
5. Backend가 예약을 확정하고 `booking.created` 이벤트를 Kafka에 발행한다.
6. Payment Consumer가 결제를 처리하고 `payment` 테이블에 저장한다.
7. Notification Consumer가 예매 확정 알림을 처리한다.
8. 웹 화면이 Backend에서 결제와 알림 완료 여부를 확인한 뒤 완료 팝업을 표시한다.
9. **승차권 확인**을 누르면 우측 상단에 예매 확정 알림이 나타난다.

## 변경 파일

- `src/public/ticketing.html`
  - 결제수단 선택 팝업
  - 결제 처리 중 화면
  - 결제·예매 완료 팝업
  - 예매 확정 알림
  - Backend 결제 상태 자동 조회
- `src/routes/payment.js`
  - 결제 정보와 함께 Kafka 알림 처리 완료 여부인 `notification_sent` 반환

## 사용자에게 표시되는 결제수단

- 신용·체크카드
- 간편결제
- 계좌이체

현재 결제 승인은 실제 PG사가 아닌 프로젝트의 Mock Payment가 처리한다. 화면 전환은 단순 타이머가 아니라 Backend의 `payment` 저장과 Kafka 알림 처리 완료 여부를 기준으로 한다.

## 배포 전제조건

- Kafka Topic이 생성되어 있어야 한다.
- Backend Deployment의 `SKIP_KAFKA_CONSUMERS`가 `false`여야 한다.
- `KAFKA_BROKERS`가 실제 Kafka Bootstrap Service를 가리켜야 한다.
- PostgreSQL에 `payment`, `processed_event` 테이블이 있어야 한다.

Kafka 준비와 배포 방법은 `KAFKA_SETUP.md`를 따른다.

## 배포 후 확인

웹페이지:

```text
https://api.nammer.store/login.html
→ 로그인
→ 열차 조회
→ 좌석 선택·선점
→ 결제수단 선택
→ 결제 처리 중
→ 결제 및 예매 완료
→ 승차권·알림 확인
```

Backend 로그:

```text
[payment-consumer] booking_id=... payment_id=... 결제 완료 이벤트 발행
[mock-notification] user_id=... 에게 예매 확정 알림 발송 (...)
[notification-consumer] booking_id=... 알림 발송 완료 (...)
```

## 장애 시 사용자 화면

Kafka 또는 Consumer 처리가 지연되면 예약 성공 여부를 숨기지 않는다.

```text
예약은 완료됐지만 결제 처리가 지연되고 있습니다.
잠시 후 상태 갱신을 눌러주세요.
```

이 경우 승차권 화면의 **상태 갱신** 버튼으로 결제 결과를 다시 확인할 수 있다.
