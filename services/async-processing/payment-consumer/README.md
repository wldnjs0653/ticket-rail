# Payment Consumer

Kafka의 `booking.created` 이벤트를 받아 Mock Payment를 호출하고
`payment.completed` 이벤트를 발행합니다.

- Consumer Group: `ticketing-payment-consumer-v1`
- Health Port: `8082`
- 처리 보장: Kafka at-least-once + Idempotency-Key

설치, 테스트, 이미지 배포와 Kubernetes 적용은 Ansible `site.yml`이 처리합니다.
