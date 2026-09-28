#!/usr/bin/env bash
# Bounded, read-only collection. Called in a separate process; errors remain explicit.
set -Eeuo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$ROOT/defaults.sh"
DEST=${1:?}; mkdir -p "$DEST"
kube() { timeout 12s kubectl --request-timeout=10s "$@"; }
# Independent operations run concurrently so a missing API does not serially stall monitoring.
kube get nodes -o json > "$DEST/nodes.json" 2> "$DEST/nodes.err" & p1=$!
kube get pods -A -o json > "$DEST/pods.json" 2> "$DEST/pods.err" & p2=$!
kube -n "$NAMESPACE" get deployment "$BACKEND_NAME" -o json > "$DEST/deployment.json" 2> "$DEST/deployment.err" & p3=$!
kube -n "$NAMESPACE" get hpa "$BACKEND_NAME" -o json > "$DEST/hpa.json" 2> "$DEST/hpa.err" & p4=$!
curl -fsS --connect-timeout 3 --max-time 10 -G "${PROMETHEUS_URL%/}/api/v1/query" --data-urlencode "query=up{namespace=\"$NAMESPACE\",service=\"$BACKEND_NAME\"}" > "$DEST/up.json" 2> "$DEST/up.err" & p5=$!
(
  if [[ $WATCH_DB == 0 ]]; then printf '{"disabled":true}\n'; exit; fi
  pod=$(kube -n "$DB_NAMESPACE" get clusters.postgresql.cnpg.io "$DB_CLUSTER" -o jsonpath='{.status.currentPrimary}')
  [[ -n "$pod" ]] || exit 1
  kube -n "$DB_NAMESPACE" exec "$pod" -c "$DB_CONTAINER" -- psql -X -qAt -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" \
    -c "BEGIN READ ONLY; SET LOCAL statement_timeout='5s'; SELECT json_build_object('readable', true, 'in_recovery', pg_is_in_recovery()); COMMIT;"
) > "$DEST/db.json" 2> "$DEST/db.err" & p6=$!
if [[ -n ${GRAFANA_URL:-} ]]; then curl -fsS --connect-timeout 3 --max-time 10 "$GRAFANA_URL/api/health" > "$DEST/grafana.json" 2> "$DEST/grafana.err" & p7=$!;
else printf '{"disabled":true}\n' > "$DEST/grafana.json"; p7=''; fi
for pid in "$p1" "$p2" "$p3" "$p4" "$p5" "$p6" ${p7:+"$p7"}; do wait "$pid" || true; done
for key in nodes pods deployment hpa up db grafana; do
  if ! jq -e 'type=="object"' "$DEST/$key.json" >/dev/null 2>&1; then printf '{"query_error":true}\n' > "$DEST/$key.json"; fi
done
# Local executor, not an arbitrary cluster node. /proc is read-only.
awk '/^cpu / {idle=$5+$6;total=0;for(i=2;i<=9;i++)total+=$i;printf "{\"total\":%.0f,\"idle\":%.0f}",total,idle;exit}' /proc/stat > "$DEST/cpu.json"
awk '/^MemTotal:/ {total=$2} /^MemAvailable:/ {avail=$2} END{if(total>0)printf "%.8f",100*avail/total;else print "null"}' /proc/meminfo > "$DEST/memory.json"
df -Pk "$DEST" | awk 'NR==2{printf "%.0f",$4*1024}' > "$DEST/disk.json"
read -r uptime _ < /proc/uptime
jq -n --slurpfile nodes "$DEST/nodes.json" --slurpfile pods "$DEST/pods.json" --slurpfile dep "$DEST/deployment.json" \
 --slurpfile hpa "$DEST/hpa.json" --slurpfile up "$DEST/up.json" --slurpfile db "$DEST/db.json" --slurpfile grafana "$DEST/grafana.json" \
 --slurpfile cpu "$DEST/cpu.json" --slurpfile memory "$DEST/memory.json" --slurpfile disk "$DEST/disk.json" \
 --argjson epoch "$(date +%s)" --argjson mono "$uptime" \
 '{epoch:$epoch,mono:$mono,nodes:$nodes[0],pods:$pods[0],deployment:$dep[0],hpa:$hpa[0],up:$up[0],db:$db[0],grafana:$grafana[0],host:{cpu:$cpu[0],memory:$memory[0],disk:$disk[0]}}' > "$DEST/sample.json"
