# Backend Monitoring Ansible

기존 Prometheus·Grafana 설치 자동화와 분리하여, Node.js 백엔드의 `/metrics`를
ServiceMonitor로 연결하고 실제 수집 상태를 검증하는 프로젝트입니다.

## 담당 범위

- 기존 ServiceMonitor CRD와 Prometheus 리소스 사전 확인
- `monitoring/backend` ServiceMonitor 자동 생성
- `app/backend` Service의 라벨과 포트 검증
- Backend Endpoint 연결 검증
- Prometheus Target `UP` 검증

Prometheus·Grafana·Alloy 설치와 Backend Deployment·Service 배포는 포함하지 않습니다.

## 1. 준비

```bash
cd ansible/monitoring/backend
cp inventory/hosts.example.ini inventory/hosts.ini
```

추가 Collection이나 Python 패키지를 설치하지 않습니다. 기존 `ansible-playbook`과
`kubectl`만 사용합니다. 클러스터 이름이나 포트가 다르면
`group_vars/all.yml`을 먼저 수정합니다.

## 2. ServiceMonitor 사전 생성

백엔드가 아직 배포되지 않았어도 실행할 수 있습니다.

```bash
ANSIBLE_CONFIG="$PWD/ansible.cfg" \
ANSIBLE_ROLES_PATH="$PWD/roles" \
ansible-playbook -i "$PWD/inventory/hosts.ini" \
"$PWD/playbooks/01-deploy-servicemonitor.yml"
```

확인:

```bash
kubectl get servicemonitor backend -n monitoring -o wide
```

## 3. 백엔드 배포 후 전체 검증

`app/backend` Deployment·Service가 배포된 다음 실행합니다.

```bash
ANSIBLE_CONFIG="$PWD/ansible.cfg" \
ANSIBLE_ROLES_PATH="$PWD/roles" \
ansible-playbook -i "$PWD/inventory/hosts.ini" \
"$PWD/playbooks/02-validate-backend-metrics.yml"
```

검증 성공 조건:

1. Backend Service 존재
2. Service에 `app=backend` 라벨 존재
3. Service에 `http` 포트 존재
4. Ready Endpoint 존재
5. Prometheus의 `up{namespace="app",service="backend"}` 값이 `1`

## 4. Grafana 확인

Grafana의 **Explore → Prometheus**에서 다음 PromQL을 실행합니다.

```promql
up{namespace="app", service="backend"}
```

```promql
http_requests_total{namespace="app"}
```

```promql
http_request_duration_seconds_count{namespace="app"}
```

도메인 지표는 해당 API에 실제 요청이 들어온 뒤 생성됩니다.

```promql
ticketing_seat_hold_total
ticketing_booking_total
ticketing_queue_join_total
ticketing_kafka_publish_total
```

## 역할 경계

CI/CD 담당자는 Backend Service에 다음 계약을 유지해야 합니다.

```yaml
metadata:
  labels:
    app: backend
spec:
  ports:
    - name: http
      port: 80
      targetPort: http
```

이 프로젝트는 위 Service를 생성하거나 수정하지 않고 검증만 합니다.
