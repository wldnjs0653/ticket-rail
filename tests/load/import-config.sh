#!/usr/bin/env bash
# Convert the old JSON settings, using jq's @sh quoting. Never execute JSON as code.
set -Eeuo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
OLD=${1:?사용법: ./import-config.sh 기존config.json [기존observability.json]}
OBS=${2:-"$ROOT/legacy-observability.json"}
ENV_OUT="$ROOT/config.imported.env"; METRICS_OUT="$ROOT/metrics.imported.json"
[[ ! -e "$ENV_OUT" && ! -e "$METRICS_OUT" ]] || { echo '기존 config.imported.env/metrics.imported.json이 있습니다. 보존할 파일을 옮긴 뒤 실행하세요.' >&2; exit 2; }
jq -e 'type=="object"' "$OLD" >/dev/null
jq -e 'type=="object"' "$OBS" >/dev/null
cp "$ROOT/config.env.example" "$ENV_OUT"
# Skip the old .local address and CA path: discover the new Ingress hostname instead.
jq -r '
{BASE_URL:(if ((.api.base_url // "")|test("^https://[^/]+\\.local/?$")) then "auto" else .api.base_url end),
 HEALTH_PATH:.api.health_path,NAMESPACE:.cluster.app_namespace,DATA_NAMESPACE:.cluster.data_namespace,MONITORING_NAMESPACE:.cluster.monitoring_namespace,
 BACKEND_NAME:.cluster.backend_name,REQUIRED_BACKEND_READY:.cluster.required_backend_ready,
 PROMETHEUS_URL:.connections.prometheus_url,MANAGE_PROMETHEUS_FORWARD:(if .connections.manage_prometheus_forward==null then null elif .connections.manage_prometheus_forward then 1 else 0 end),PROMETHEUS_SERVICE:.connections.prometheus_service,GRAFANA_URL:.connections.grafana_url,
 EVENT_ID:.data.event_id,USER_ID:.data.e2e_user_id,SEAT_ID:.data.e2e_seat_id,USER_IDS:(.data.concurrency_user_ids // []|map(tostring)|join(",")),
 NORMAL_VUS:.load.normal_vus,PEAK_VUS:.load.peak_vus,SPIKE_VUS:.load.spike_vus,
 WATCH_DB:(if .database.enabled==null then null elif .database.enabled then 1 else 0 end),DB_NAMESPACE:.database.namespace,DB_CLUSTER:.database.cluster,DB_NAME:.database.database,DB_USER:.database.user,DB_CONTAINER:.database.container,
 WATCH_INTERVAL:.monitor.sample_seconds,BASELINE_SECONDS:.monitor.baseline_seconds,BACKEND_UNREADY_SECONDS:.monitor.backend_unready_seconds,COLLECTION_FAILURE_SECONDS:.monitor.collection_failure_seconds,
 HTTP_FAILURE_RATIO:.monitor.http_failure_ratio,HTTP_FAILURE_SUSTAIN_SECONDS:.monitor.http_failure_sustain_seconds,
 EXECUTOR_CPU_PERCENT:.monitor.executor_cpu_percent,EXECUTOR_CPU_SUSTAIN_SECONDS:.monitor.executor_cpu_sustain_seconds,EXECUTOR_AVAILABLE_MEMORY_PERCENT:.monitor.executor_available_memory_percent,EXECUTOR_FREE_DISK_GIB:.monitor.executor_free_disk_gib}
 | to_entries[] | select(.value!=null and .value!="") | .key+"="+(.value|tostring|@sh)' "$OLD" >> "$ENV_OUT"
jq -nr --arg path "$METRICS_OUT" '"METRICS_FILE="+($path|@sh)' >> "$ENV_OUT"
jq --slurpfile old "$OLD" --slurpfile obs "$OBS" '
 def mapping: {queue_depth_expr:"queue_depth",queue_join_rate_expr:"queue_join_rate",queue_admit_rate_expr:"queue_admit_rate",queue_wait_p95_expr:"queue_wait_p95",redis_latency_expr:"redis_latency",redis_memory_bytes:"redis_memory",postgres_connections_expr:"pg_connections",kafka_consumer_lag_expr:"kafka_lag",backend_cpu_cores:"cpu",backend_memory_bytes:"memory"};
 def translate: split("$namespace")|join("__NS__") | split("$backend_name")|join("__BACKEND__") | split("$backend_pod")|join("__BACKEND__-.*") | split("$event_id")|join("__EVENT__") | split("$__rate_interval")|join("__RATE__");
 reduce (($obs[0]|to_entries[]|select(.key|endswith("_expr"))), (($old[0].extra_promql // {})|to_entries[])) as $item (.;
  if ($item.value|type)=="string" and $item.value!="" then
   (mapping[$item.key] // $item.key) as $key |
   if any(.[];.key==$key) then map(if .key==$key then .query=($item.value|translate) else . end)
   else .+[{key:$key,label:$key,section:"extra",unit:"원본 쿼리 단위",type:"range",query:($item.value|translate)}] end
  else . end)' "$ROOT/metrics.json" > "$METRICS_OUT"
echo '가져오기 완료: config.imported.env / metrics.imported.json'
echo '실행: CONFIG_FILE=./config.imported.env ./run.sh check load'
echo '기존 .local 주소·내부 CA는 이전하지 않습니다. 동시성용 좌석이 E2E와 다르면 실행 전 SEAT_ID를 바꾸세요.'
