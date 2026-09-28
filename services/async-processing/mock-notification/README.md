# Mock Notification

실제 문자나 이메일을 발송하지 않고 알림 발송 성공 결과를 반환하는
Node.js·Express 서비스입니다.

Ansible Controller가 테스트, 이미지 생성, 워커 배포와 Kubernetes 적용을
처리합니다.

```bash
ansible-playbook ansible/site.yml
```

## API

- `GET /health/live`
- `GET /health/ready`
- `POST /notifications`

Kubernetes 내부 주소는
`mock-notification.app.svc.cluster.local:8081`이며 정상 알림 요청에는 `SENT`를
반환합니다. 같은 `Idempotency-Key`에는 동일한 `notification_id`를 반환합니다.
