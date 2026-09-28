# Kafka 비동기 처리 적용

## 처리 흐름

예약 확정 후 API 응답과 분리해 다음 흐름이 실행됩니다.

booking.created → Payment Consumer → payment.completed → Notification Consumer

Payment Consumer는 payment 테이블에 예약당 한 건만 저장합니다. Consumer가
재시작되거나 이벤트가 중복 전달돼도 booking_id UNIQUE 제약을 이용해 중복
결제를 방지합니다. Notification Consumer는 processed_event로 완료 이벤트를
기록해 같은 알림을 다시 처리하지 않습니다.

## 최초 1회: Topic 생성

Strimzi Topic Operator가 설치된 클러스터에서 실행합니다.

~~~bash
kubectl apply -f k8s/data/kafka-topics.yaml
kubectl get kafkatopic -n data
~~~

booking.created, payment.completed, notification.requested가 Ready인지 확인합니다.

## 배포

main 브랜치 CI/CD는 Backend 이미지와 다음 환경변수를 함께 적용합니다.

~~~text
SKIP_KAFKA_CONSUMERS=false
KAFKA_BROKERS=ticketing-kafka-kafka-bootstrap.data.svc.cluster.local:9092
KAFKA_CLIENT_ID=ticketing-backend
KAFKA_CONSUMER_GROUP=ticketing-backend-consumers
~~~

## 확인

새 예약을 한 건 만든 뒤 아래 항목을 확인합니다.

~~~bash
kubectl logs -n app -l app=backend --since=10m --prefix |
  grep -E 'payment-consumer|notification-consumer|mock-notification'
~~~

~~~sql
SELECT id, booking_id, status, amount, processed_at
FROM payment
ORDER BY id DESC
LIMIT 10;

SELECT event_id, event_type, processed_at
FROM processed_event
ORDER BY processed_at DESC
LIMIT 20;
~~~

정상 기준:

- 예약당 payment 1건
- booking.created 처리 기록 1건
- payment.completed 처리 기록 1건
- Mock 알림 완료 로그 1건
