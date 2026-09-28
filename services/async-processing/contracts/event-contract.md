# Kafka Event Contract

Node.js Backend와 Consumer가 함께 사용하는 표준 메시지 형식입니다.

| Topic | Producer | Consumer | Message Key |
| --- | --- | --- | --- |
| `booking.created` | Node.js Backend | Payment Consumer | `aggregate_id` |
| `payment.completed` | Payment Consumer | Notification Consumer | `aggregate_id` |

## booking.created

```json
{
  "event_id": "uuid",
  "event_type": "booking.created",
  "aggregate_id": "booking-1001",
  "occurred_at": "2026-09-02T10:00:00Z",
  "version": 1,
  "payload": {
    "booking_id": 1001,
    "user_id": 10,
    "amount": 50000,
    "currency": "KRW"
  }
}
```

필수 필드: `event_id`, `event_type`, `aggregate_id`, `occurred_at`, `version`,
`payload.booking_id`, `payload.user_id`, `payload.amount`.

## payment.completed

```json
{
  "event_id": "uuid",
  "event_type": "payment.completed",
  "aggregate_id": "booking-1001",
  "occurred_at": "2026-09-02T10:00:03Z",
  "version": 1,
  "causation_id": "booking.created의 event_id",
  "payload": {
    "booking_id": 1001,
    "user_id": 10,
    "payment_id": "payment-2001",
    "amount": 50000,
    "currency": "KRW",
    "status": "SUCCEEDED"
  }
}
```

## 처리 규칙

- Kafka Consumer Group은 메시지를 at-least-once 방식으로 처리합니다.
- HTTP 호출에는 원본 `event_id`를 `Idempotency-Key`로 전달합니다.
- Mock Payment와 Mock Notification은 같은 키에 항상 같은 결과 ID를 반환합니다.
- 처리 중 오류가 발생하면 Consumer가 예외를 반환해 Kafka offset 커밋을 막고
  메시지를 다시 처리합니다.
- Node.js Backend도 `booking.created` 발행 시 위 형식과 Message Key를 지켜야 합니다.
