# Notification Consumer

Kafka의 `payment.completed` 이벤트를 받아 Mock Notification을 호출합니다.

- Consumer Group: `ticketing-notification-consumer-v1`
- Health Port: `8083`
- 처리 보장: Kafka at-least-once + Idempotency-Key

설치, 테스트, 이미지 배포와 Kubernetes 적용은 Ansible `site.yml`이 처리합니다.
