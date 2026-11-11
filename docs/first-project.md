# TicketRail 온프레미스 인프라 구축

온프레미스에 Kubernetes 기반의 열차 예매 인프라를 구축하고, 서비스가 안정적으로 동작하는지 검증했습니다.

[프로젝트 상세](https://app.notion.com/p/TicketRail-40f7416fb05f81e4bdfaeedf3dcbaebb?pvs=12)

## 인프라 구축 코드

| 항목 | 확인할 내용 | 바로가기 |
|---|---|---|
| **Kubernetes 구성** | 애플리케이션 배포, 자동 확장(HPA), Ingress, MetalLB 설정 | [구성 파일 보기](../k8s) |
| **Ansible 자동화** | 인프라 구성과 운영에 사용한 플레이북 | [자동화 코드 보기](../ansible) |

## 구현 및 검증 코드

| 항목 | 확인할 내용 | 바로가기 |
|---|---|---|
| **기능** | 대기열 입장, 좌석 선점, 예약 처리 | [예매 서비스 코드](../src) |
| **동시성** | 여러 요청이 같은 좌석에 들어와도 한 건만 선점되는지 확인 | [좌석 동시성 시험](../tests/concurrency) |
| **부하** | 트래픽이 늘어날 때 대기열 처리와 Backend 자동 확장 확인 | [k6 부하 시험](../tests/load) |
| **장애 대응** | Pod·노드·데이터 계층의 장애 전환과 복구 확인 | [장애 시험 시나리오](../tests/failure) |
| **CI/CD** | GitHub Actions와 Ansible을 연계한 배포 자동화 및 배포 결과 확인 | [워크플로](../.github/workflows/ci.yml) · [배포 플레이북](../ansible/deploy/backend.yml) |

[이전 첫 화면](../README.md)
