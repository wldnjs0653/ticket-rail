#!/usr/bin/env bash

set -Eeuo pipefail

MODE="setup"
M1_IP="10.1.93.62"
M1_USER="root"
ADMIN_VM_IP="10.1.93.115"
API_VIP="10.1.93.65"
API_PORT="6443"
SOURCE_KUBECONFIG="/etc/kubernetes/admin.conf"
LOCAL_KUBECONFIG="/root/.kube/config"
WATCH_INTERVAL="1"

CONTROL_DIR=""
LOCAL_TMP=""
M1_TARGET=""
SSH_OPTIONS=()
SCP_OPTIONS=()

usage() {
  cat <<'EOF'
Kubernetes 외부 관리자 VM(.115) 구성 및 API HA 확인 스크립트

이 스크립트는 10.1.93.115 관리자 VM에서 실행합니다.

사용법:
  sudo ./setup-kubectl-controller.sh setup
  ./setup-kubectl-controller.sh verify
  ./setup-kubectl-controller.sh watch

모드:
  setup   M1에서 kubectl과 admin.conf를 가져와 .115에 설치하고 검증합니다.
  verify  .115에서 API VIP와 Kubernetes 상태를 확인합니다.
  watch   .115에서 API /readyz를 반복 호출하여 장애 전환을 관찰합니다.

옵션:
  --m1-ip IP          M1 주소 (기본값: 10.1.93.62)
  --m1-user USER      M1 SSH 사용자 (기본값: root)
  --admin-ip IP       현재 관리자 VM 주소 확인용 (기본값: 10.1.93.115)
  --api-vip IP        Kubernetes API VIP (기본값: 10.1.93.65)
  --api-port PORT     Kubernetes API 포트 (기본값: 6443)
  --kubeconfig PATH   M1의 원본 kubeconfig (기본값: /etc/kubernetes/admin.conf)
  --interval SECONDS  watch 호출 간격 (기본값: 1)
  -h, --help          도움말 표시

예시:
  sudo ./setup-kubectl-controller.sh setup
  ./setup-kubectl-controller.sh verify
  ./setup-kubectl-controller.sh watch --interval 0.5

주의:
  admin.conf에는 cluster-admin 권한이 있으므로 파일을 외부에 공유하지 마십시오.
  이 스크립트는 M1 또는 LB 서비스를 자동으로 중지하지 않습니다.
EOF
}

log() {
  printf '[INFO] %s\n' "$*"
}

warn() {
  printf '[WARN] %s\n' "$*" >&2
}

die() {
  printf '[ERROR] %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "필수 명령을 찾을 수 없습니다: $1"
}

cleanup() {
  if [[ -n "${CONTROL_DIR}" && -n "${M1_TARGET}" ]]; then
    ssh "${SSH_OPTIONS[@]}" -O exit "${M1_TARGET}" >/dev/null 2>&1 || true
  fi

  if [[ -n "${CONTROL_DIR}" && -d "${CONTROL_DIR}" ]]; then
    rmdir "${CONTROL_DIR}" >/dev/null 2>&1 || true
  fi

  if [[ -n "${LOCAL_TMP}" && "${LOCAL_TMP}" == /tmp/k8s-admin-pull.* && -d "${LOCAL_TMP}" ]]; then
    rm -f "${LOCAL_TMP}/kubectl" "${LOCAL_TMP}/admin.conf"
    rmdir "${LOCAL_TMP}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

parse_arguments() {
  if [[ $# -gt 0 && "$1" != -* ]]; then
    MODE="$1"
    shift
  fi

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --m1-ip)
        [[ $# -ge 2 ]] || die "--m1-ip 값이 필요합니다."
        M1_IP="$2"
        shift 2
        ;;
      --m1-user)
        [[ $# -ge 2 ]] || die "--m1-user 값이 필요합니다."
        M1_USER="$2"
        shift 2
        ;;
      --admin-ip)
        [[ $# -ge 2 ]] || die "--admin-ip 값이 필요합니다."
        ADMIN_VM_IP="$2"
        shift 2
        ;;
      --api-vip)
        [[ $# -ge 2 ]] || die "--api-vip 값이 필요합니다."
        API_VIP="$2"
        shift 2
        ;;
      --api-port)
        [[ $# -ge 2 ]] || die "--api-port 값이 필요합니다."
        API_PORT="$2"
        shift 2
        ;;
      --kubeconfig)
        [[ $# -ge 2 ]] || die "--kubeconfig 값이 필요합니다."
        SOURCE_KUBECONFIG="$2"
        shift 2
        ;;
      --interval)
        [[ $# -ge 2 ]] || die "--interval 값이 필요합니다."
        WATCH_INTERVAL="$2"
        shift 2
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        die "알 수 없는 옵션입니다: $1"
        ;;
    esac
  done

  case "${MODE}" in
    setup|verify|watch) ;;
    *) die "지원하지 않는 모드입니다: ${MODE}" ;;
  esac

  [[ "${M1_USER}" == "root" ]] \
    || die "현재 스크립트는 M1의 root 계정만 지원합니다."
  [[ "${API_PORT}" =~ ^[0-9]+$ ]] || die "API 포트가 올바르지 않습니다: ${API_PORT}"
  [[ "${WATCH_INTERVAL}" =~ ^[0-9]+([.][0-9]+)?$ ]] || die "watch 간격이 올바르지 않습니다: ${WATCH_INTERVAL}"
}

check_execution_host() {
  require_command hostname

  local local_ips
  local_ips="$(hostname -I 2>/dev/null || true)"

  if [[ " ${local_ips} " != *" ${ADMIN_VM_IP} "* ]]; then
    warn "현재 VM 주소에서 ${ADMIN_VM_IP}를 찾지 못했습니다: ${local_ips:-확인 불가}"
    warn "정말 .115 관리자 VM인지 확인한 뒤 계속하십시오."
  else
    log "관리자 VM 주소 확인: ${ADMIN_VM_IP}"
  fi
}

prepare_m1_ssh() {
  require_command ssh
  require_command scp

  M1_TARGET="${M1_USER}@${M1_IP}"
  CONTROL_DIR="$(mktemp -d -t k8s-admin-ssh.XXXXXX)"

  SSH_OPTIONS=(
    -o StrictHostKeyChecking=accept-new
    -o ControlMaster=auto
    -o "ControlPath=${CONTROL_DIR}/%C"
    -o ControlPersist=60
    -o ConnectTimeout=5
  )

  SCP_OPTIONS=(
    -o StrictHostKeyChecking=accept-new
    -o ControlMaster=auto
    -o "ControlPath=${CONTROL_DIR}/%C"
    -o ControlPersist=60
    -o ConnectTimeout=5
  )

  log "M1 SSH 연결 확인: ${M1_TARGET}"
  ssh "${SSH_OPTIONS[@]}" "${M1_TARGET}" true \
    || die "M1에 SSH로 연결할 수 없습니다: ${M1_TARGET}"
}

check_m1_source() {
  local result
  local remote_endpoint
  local remote_kubectl

  result="$(ssh "${SSH_OPTIONS[@]}" "${M1_TARGET}" bash -s -- \
    "${SOURCE_KUBECONFIG}" <<'REMOTE_CHECK'
set -Eeuo pipefail

source_kubeconfig="$1"
kubectl_path="$(command -v kubectl)"
kubectl_path="$(readlink -f "${kubectl_path}")"

[[ -x "${kubectl_path}" ]] || {
  printf '[ERROR] M1의 kubectl을 찾을 수 없습니다.\n' >&2
  exit 1
}

[[ -r "${source_kubeconfig}" ]] || {
  printf '[ERROR] M1의 kubeconfig를 읽을 수 없습니다: %s\n' "${source_kubeconfig}" >&2
  exit 1
}

endpoint="$(KUBECONFIG="${source_kubeconfig}" kubectl config view --minify \
  -o jsonpath='{.clusters[0].cluster.server}')"

printf 'KUBECTL_PATH=%s\nAPI_ENDPOINT=%s\n' "${kubectl_path}" "${endpoint}"
REMOTE_CHECK
)"

  remote_kubectl="$(printf '%s\n' "${result}" | sed -n 's/^KUBECTL_PATH=//p' | tail -n 1)"
  remote_endpoint="$(printf '%s\n' "${result}" | sed -n 's/^API_ENDPOINT=//p' | tail -n 1)"

  [[ "${remote_kubectl}" == /* ]] || die "M1 kubectl 경로 확인에 실패했습니다."
  [[ "${remote_endpoint}" == "https://${API_VIP}:${API_PORT}" ]] \
    || die "M1 kubeconfig API 주소가 VIP와 다릅니다. 현재=${remote_endpoint}, 기대=https://${API_VIP}:${API_PORT}"

  printf '%s' "${remote_kubectl}"
}

pull_admin_client() {
  local remote_kubectl

  [[ "${EUID}" -eq 0 ]] || die "setup 모드는 .115에서 root 권한으로 실행해야 합니다."
  require_command install
  require_command mktemp
  require_command sed
  require_command tail

  remote_kubectl="$(check_m1_source)"
  LOCAL_TMP="$(mktemp -d /tmp/k8s-admin-pull.XXXXXX)"

  log "M1에서 kubectl을 가져옵니다: ${remote_kubectl}"
  scp "${SCP_OPTIONS[@]}" "${M1_TARGET}:${remote_kubectl}" "${LOCAL_TMP}/kubectl"

  log "M1에서 kubeconfig를 가져옵니다: ${SOURCE_KUBECONFIG}"
  scp "${SCP_OPTIONS[@]}" "${M1_TARGET}:${SOURCE_KUBECONFIG}" "${LOCAL_TMP}/admin.conf"

  install -m 0755 "${LOCAL_TMP}/kubectl" /usr/local/bin/kubectl
  install -d -m 0700 /root/.kube
  install -m 0600 "${LOCAL_TMP}/admin.conf" "${LOCAL_KUBECONFIG}"

  rm -f "${LOCAL_TMP}/kubectl" "${LOCAL_TMP}/admin.conf"
  rmdir "${LOCAL_TMP}"
  LOCAL_TMP=""

  log ".115에 kubectl과 kubeconfig 설치를 완료했습니다."
}

verify_local() {
  require_command kubectl
  require_command timeout

  [[ -r "${LOCAL_KUBECONFIG}" ]] \
    || die "로컬 kubeconfig를 읽을 수 없습니다: ${LOCAL_KUBECONFIG}. setup을 먼저 실행하십시오."

  export KUBECONFIG="${LOCAL_KUBECONFIG}"

  local endpoint
  endpoint="$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}')"
  printf '[CHECK] API endpoint: %s\n' "${endpoint}"

  [[ "${endpoint}" == "https://${API_VIP}:${API_PORT}" ]] \
    || die "kubeconfig가 API VIP를 사용하지 않습니다. 기대=https://${API_VIP}:${API_PORT}"

  if timeout 5 bash -c "</dev/tcp/${API_VIP}/${API_PORT}"; then
    printf '[CHECK] TCP %s:%s 연결 성공\n' "${API_VIP}" "${API_PORT}"
  else
    die "TCP ${API_VIP}:${API_PORT} 연결 실패"
  fi

  printf '[CHECK] Kubernetes API readyz: '
  kubectl --request-timeout=5s get --raw='/readyz'
  printf '\n'

  printf '\n[CHECK] Kubernetes Nodes\n'
  kubectl get nodes -o wide
}

watch_local() {
  require_command kubectl

  [[ -r "${LOCAL_KUBECONFIG}" ]] \
    || die "로컬 kubeconfig를 읽을 수 없습니다: ${LOCAL_KUBECONFIG}. setup을 먼저 실행하십시오."

  export KUBECONFIG="${LOCAL_KUBECONFIG}"

  log ".115에서 API VIP 상태 감시를 시작합니다. 종료하려면 Ctrl+C를 누르십시오."
  warn "이 화면을 유지한 상태에서 VMware 콘솔 또는 별도 터미널로 장애 테스트를 수행하십시오."

  while true; do
    local now
    local output

    now="$(date '+%Y-%m-%d %H:%M:%S')"

    if output="$(kubectl --request-timeout=3s get --raw='/readyz' 2>&1)"; then
      output="${output//$'\n'/ }"
      printf '%s  OK    %s\n' "${now}" "${output}"
    else
      output="${output//$'\n'/ }"
      printf '%s  FAIL  %s\n' "${now}" "${output}"
    fi

    sleep "${WATCH_INTERVAL}"
  done
}

main() {
  parse_arguments "$@"
  check_execution_host

  case "${MODE}" in
    setup)
      prepare_m1_ssh
      pull_admin_client
      verify_local
      printf '\n'
      log "설정 완료: 이후에는 .115에서 다음 명령을 사용하십시오."
      printf '  %s verify\n' "$0"
      printf '  %s watch\n' "$0"
      ;;
    verify)
      verify_local
      ;;
    watch)
      watch_local
      ;;
  esac
}

main "$@"
