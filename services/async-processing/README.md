# Ticketing Consumer & Mock Services

티켓팅 프로젝트의 결제·알림 비동기 흐름을 담당하는 Node.js 서비스와
Kubernetes 배포 자동화입니다. 모든 명령은 `10.1.93.115` Ansible Controller에서
실행하며, 실제 서비스는 Kubernetes `app` namespace에서 동작합니다.

## 구성 요소

| 구성 요소 | 역할 | 복제본 |
| --- | --- | ---: |
| Mock Payment | 가상 결제 성공 처리 | 2 |
| Mock Notification | 가상 이메일·문자 발송 | 2 |
| Payment Consumer | `booking.created` 처리 및 `payment.completed` 발행 | 2 |
| Notification Consumer | `payment.completed` 처리 및 알림 요청 | 2 |

```text
ticketing-consumer-mock/
├── ansible.cfg
├── ansible/
│   ├── bootstrap.yml
│   ├── site.yml
│   ├── test.yml
│   ├── build-images.yml
│   ├── distribute-images.yml
│   ├── deploy-k8s.yml
│   ├── validate-k8s.yml
│   ├── vars/main.yml
│   └── templates/k8s-stack.yml.j2
├── contracts/event-contract.md
├── mock-payment/
├── mock-notification/
├── payment-consumer/
└── notification-consumer/
```

## 사전 조건

- `ansible/cluster/inventory.ini`에 `[workers]`가 3대 이상 등록되어 있어야 합니다.
- `/root/.kube/config`으로 Kubernetes API에 접근할 수 있어야 합니다.
- Kafka `booking.created`, `payment.completed` Topic이 Ready 상태여야 합니다.
- `.115`와 Worker가 필요한 컨테이너 이미지를 받을 수 있어야 합니다.

## 전체 실행

폴더 전체를 아래 경로에 반영한 후 두 플레이북만 실행합니다.

```bash
cd services/async-processing

ansible-playbook ansible/bootstrap.yml
/opt/ticket-rail-venv/bin/ansible-playbook ansible/site.yml
```

`bootstrap.yml`은 Node.js 24 LTS, Podman, kubeconfig와 Worker 인벤토리를
준비·검증합니다. `site.yml`은 다음 작업을 순서대로 처리합니다.

1. 네 Node.js 서비스의 의존성 설치와 자동 테스트
2. Podman으로 네 OCI 이미지 빌드
3. 이미지를 W1·W2·W3의 containerd로 배포
4. Kubernetes `app` namespace에 2개 복제본씩 배포
5. readiness/liveness와 rollout 확인
6. `booking.created → 결제 → payment.completed → 알림` 실제 흐름 검증
7. 이전 단계의 `.115` 임시 systemd Mock 서비스 중지

정상 완료 기준은 마지막 `PLAY RECAP`의 `failed=0`과 최종
`Result: PASSED`입니다.

## 주요 주소

```text
Kafka: ticketing-kafka-kafka-bootstrap.data:9092
Mock Payment: mock-payment.app:8080
Mock Notification: mock-notification.app:8081
```

클러스터 DNS suffix를 고정하지 않는 `service.namespace` 형식이며 Kubernetes
내부 전용입니다. `.115`는 서비스를 직접 실행하지 않고
Ansible과 kubectl을 이용해 배포·검증하는 관리자 역할을 담당합니다.

Kafka 메시지 형식은 `contracts/event-contract.md`를 Backend 담당자와 함께
사용합니다.
