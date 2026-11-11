# Full AWS Terraform 참조 구성

[프로젝트 구성도](../../../../docs/images/phase-2/full-aws-architecture.png)를 기준으로 새로 작성한 포트폴리오용 코드입니다.

| 구성 | Terraform에서 정의하는 리소스 |
|---|---|
| 네트워크 | 서울 리전의 VPC, 3개 AZ의 퍼블릭·프라이빗 서브넷, NAT 및 보안 그룹 |
| ROSA HCP | 프라이빗 서브넷에 배치되는 워커 3개, 퍼블릭 Ingress, STS 역할과 OIDC |
| ElastiCache for Valkey | Primary 1개와 Replica 2개, 자동 장애 전환, TLS와 AUTH |
| RDS for PostgreSQL | Multi-AZ DB 인스턴스, 암호화 스토리지와 관리형 마스터 비밀번호 |
| Amazon MSK | 프라이빗 브로커 3개, TLS와 IAM 인증 |

데이터 서비스는 프라이빗 서브넷에 두고, 지정된 ROSA 워커 보안 그룹에서 각 서비스 포트로 접근하도록 설정했습니다.

## 코드 검증

이 폴더에서 다음 명령으로 형식과 공급자 스키마를 확인할 수 있습니다.

```sh
terraform fmt -check
terraform init -backend=false
terraform validate
```

## AWS 계정에 적용하려면

- ROSA HCP를 사용할 수 있는 AWS 계정과 권한, 연결된 Red Hat 계정의 `RHCS_TOKEN`, 서울 리전에서 사용할 수 있는 `openshift_version`이 필요합니다.
- `TF_VAR_valkey_auth_token`으로 Valkey AUTH 토큰을 전달합니다. Terraform 상태 파일에는 토큰이 저장되므로 암호화와 접근 제어가 필요합니다.
- 실제 인프라를 생성하면 비용이 발생합니다. RDS 삭제 보호를 해제하려면 `database_deletion_protection`을 변경해야 하며, 최종 스냅샷 이름은 같은 리전에서 고유해야 합니다.

애플리케이션 배포는 별도 단계입니다. `terraform output`의 주소를 바탕으로 Valkey TLS·AUTH, PostgreSQL TLS·계정, MSK TLS·IAM을 앱과 Consumer에 설정하고, DB 스키마와 Kafka 토픽을 준비해야 합니다. OpenShift Route와 HPA·KEDA는 워크로드 배포 시 구성합니다.

공식 참고 자료 · [ROSA HCP와 VPC](https://docs.aws.amazon.com/rosa/latest/userguide/getting-started-hcp.html) · [ROSA Terraform 모듈](https://registry.terraform.io/modules/terraform-redhat/rosa-hcp/rhcs/1.6.8) · [Valkey AUTH](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/auth.html) · [MSK IAM 인증](https://docs.aws.amazon.com/msk/latest/developerguide/iam-access-control.html)
