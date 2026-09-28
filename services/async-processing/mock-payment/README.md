# Mock Payment

실제 결제사를 호출하지 않고 결제 성공 결과를 반환하는 Node.js·Express 서비스입니다.
Ansible Controller가 이미지를 만들고 Kubernetes `app` namespace에 2개
복제본으로 배포합니다.

## Run

다음 명령은 `services/async-processing`에서 실행합니다. Node.js 설치,
의존성 설치, 테스트, 서비스 시작과 검증이 모두 플레이북으로 처리됩니다.

```bash
ansible-playbook ansible/bootstrap.yml
ansible-playbook ansible/site.yml
```

## Kubernetes 내부 API

```bash
http://mock-payment.app.svc.cluster.local:8080/health/ready
```

## Create a mock payment

```bash
curl -X POST http://mock-payment.app.svc.cluster.local:8080/payments \
  -H 'Content-Type: application/json' \
  -d '{
    "booking_id": 1001,
    "user_id": 10,
    "amount": 50000,
    "currency": "KRW"
  }'
```

응답에는 생성된 `payment_id`와 고정된 성공 상태인 `SUCCEEDED`가 포함됩니다.
같은 `Idempotency-Key`에는 동일한 `payment_id`를 반환합니다.
