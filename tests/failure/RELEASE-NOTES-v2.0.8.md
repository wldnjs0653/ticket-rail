# v2.0.8 HTTPS·SNI 전환 반영

## 수정 이유

`https://10.1.93.69`에 HTTP `Host` Header만 추가하면 TLS Handshake에서 SNI가
IP 주소로 전달된다. Strict SNI가 설정된 Ingress에서는 HTTP 요청이 전달되기 전에
`tlsv1 unrecognized name`으로 거부된다.

또한 `00_setup.sh`와 `01_precheck.sh`는 시험용 리소스를 배포하지 않으므로 그 단계에서
`failure-test` Namespace가 없는 것은 정상이다. 시험용 Namespace·Pod·Service·Ingress와
TLS Secret은 P-01 또는 N-01을 실행할 때 생성하고 종료 시 삭제한다.

## 변경 사항

- 시험 URL을 `https://failure-test.ticketing.local/`로 변경
- URL hostname은 TLS SNI와 HTTP Host로 사용하고 실제 연결은
  `traffic_test_connect_ip: 10.1.93.69`로 분리
- P-01/N-01 시작 시 이틀 유효한 자체 서명 시험용 인증서와 TLS Secret 자동 생성
- 시험용 Ingress에 `spec.tls.hosts`와 `secretName` 추가
- 외부 경로 검증을 curl `--resolve` 방식으로 변경하고 Ingress 반영을 최대 30초 재확인
- Python 연속 Probe에 `--connect-ip`를 추가해 SNI hostname과 접속 VIP를 분리
- Backend k6 기본 URL을 `https://api.ticketing.local`로 변경
- k6 실행기가 `K6_HOSTS_JSON`으로 hostname→VIP 설정 파일을 자동 생성
- HTTP 301/308을 성공으로 세지 않고 2xx만 성공으로 판정
- 격리 NGINX 응답의 `pod=`와 `node=` 본문 검증

## 실행 순서

```bash
cd tests/failure

scripts/00_setup.sh
scripts/01_precheck.sh

CONFIRM_DISRUPTIVE_TESTS=YES \
  scripts/10_pod_autohealing.sh
```

시험용 HTTPS 리소스는 세 번째 명령 안에서 자동으로 배포된다. 따라서 그 전에 다음
명령에서 `NotFound`가 나오는 것은 정상이다.

```bash
kubectl -n failure-test get ingress,secret
```

## 운영 인증서를 사용하는 경우

자체 서명 인증서 대신 신뢰 가능한 인증서를 사용하도록 별도 구성했다면
`failure-tests/group_vars/all.yml`의 `traffic_tls_verify`를 `true`로 변경한다. k6도
`K6_INSECURE_SKIP_TLS_VERIFY=false`로 실행한다.
