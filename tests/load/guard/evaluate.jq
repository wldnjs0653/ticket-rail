# Stateful rules. Monotonic time for persistence; wall-clock time only for k6 points.
def ready: any(.status.conditions[]?; .type=="Ready" and .status=="True");
def held($key;$bad;$seconds;$label):
  if $bad then .since[$key] //= $s.mono | if $s.mono-.since[$key]>=$seconds then .reasons+=[$label] else . end
  else del(.since[$key]) end;
def raise($bad;$label): if $bad then .reasons+=[$label] else . end;
$s as $s |
([$s.pods.items[]? | select(.metadata.namespace==$ENV.NAMESPACE or .metadata.namespace==$ENV.DATA_NAMESPACE or .metadata.namespace==$ENV.MONITORING_NAMESPACE) | select(.status.phase!="Succeeded" and .status.phase!="Failed" and .metadata.deletionTimestamp==null)] ) as $pods |
([$pods[] | select(.metadata.namespace==$ENV.NAMESPACE and .metadata.labels.app==$ENV.BACKEND_NAME and .metadata.deletionTimestamp==null and .status.phase!="Succeeded" and .status.phase!="Failed")]) as $api |
([$api[] | select(ready)]|length) as $apiReady |
([$s.up.data.result[]? | select(.value[1]=="1") | .metric.pod]) as $targets |
($s.nodes.kind=="NodeList" and ($s.nodes.items|length)>0 and $s.pods.kind=="PodList" and $s.deployment.kind=="Deployment") as $clusterOK |
($s.up.status=="success" and ($s.up.data.result|length)>0 and all($s.up.data.result[]; .value[1]=="1") and all($api[]; .metadata.name as $p | ($targets|index($p))!=null)) as $upOK |
([$pods[] as $p | ($p.status.containerStatuses[]?, $p.status.initContainerStatuses[]?) |
  {key:($p.metadata.uid+"/"+.name), value:{n:(.restartCount // 0), oom:(.state.terminated.reason=="OOMKilled"), last_oom:(.lastState.terminated.reason=="OOMKilled"), label:($p.metadata.namespace+"/"+$p.metadata.name+"/"+.name)}}] | from_entries) as $restarts |
([$http.b[]? | select(.t>$s.epoch-($ENV.HTTP_WINDOW_SECONDS|tonumber) and .t<=$s.epoch)]) as $bins |
($bins|map(.n)|add // 0) as $n | ($bins|map(.f)|add // 0) as $f |
(if $n>0 then $f/$n else null end) as $ratio |
(if $prev.host.cpu.total!=null and $s.host.cpu.total>$prev.host.cpu.total then
  100*(1-($s.host.cpu.idle-$prev.host.cpu.idle)/($s.host.cpu.total-$prev.host.cpu.total)) else null end) as $cpu |
([$s.hpa.status.currentMetrics[]? | select(.type=="Resource" and .resource.name=="cpu") | .resource.current.averageUtilization][0]) as $hpaCPU |
([$s.hpa.spec.metrics[]? | select(.type=="Resource" and .resource.name=="cpu") | .resource.target.averageUtilization][0]) as $hpaTarget |
{since:($prev.since // {}),reasons:[],host:$s.host,restarts:$restarts,template:$s.deployment.spec.template,
 observed_at:$s.epoch,mono:$s.mono,backend_ready:$apiReady,http_window_requests:$n,http_failure_ratio:$ratio,executor_cpu_percent:$cpu} |
raise($clusterOK and any($s.nodes.items[]; ready|not); "Node NotReady") |
held("ready"; $clusterOK and ($apiReady<($ENV.REQUIRED_BACKEND_READY|tonumber) or $apiReady<($api|length)); ($ENV.BACKEND_UNREADY_SECONDS|tonumber); "Backend Ready 미달 지속") |
raise($clusterOK and $baseline.template!=null and $baseline.template!=$s.deployment.spec.template; "Backend Deployment template 변경") |
raise(any($restarts|to_entries[]; .value.oom); "OOMKilled") |
raise($prev.restarts!=null and any($restarts|to_entries[]; . as $r | $r.value.n>($prev.restarts[$r.key].n // 0)); "새 컨테이너 재시작") |
held("collection"; ($clusterOK and $upOK and $s.hpa.kind=="HorizontalPodAutoscaler" and $hpaCPU!=null and $hpaTarget!=null and $s.host.memory!=null and $s.host.disk!=null)|not; ($ENV.COLLECTION_FAILURE_SECONDS|tonumber); "필수 관측 경로 장애 지속") |
raise($ENV.WATCH_DB=="1" and ($s.db.readable!=true or $s.db.in_recovery!=false); "PostgreSQL Primary 읽기 접근 실패") |
held("host_cpu"; $cpu!=null and $cpu>=($ENV.EXECUTOR_CPU_PERCENT|tonumber); ($ENV.EXECUTOR_CPU_SUSTAIN_SECONDS|tonumber); "k6 실행 서버 CPU 포화 지속") |
raise($s.host.memory!=null and $s.host.memory<($ENV.EXECUTOR_AVAILABLE_MEMORY_PERCENT|tonumber); "k6 실행 서버 메모리 여유 부족") |
raise($s.host.disk!=null and $s.host.disk<($ENV.EXECUTOR_FREE_DISK_GIB|tonumber)*1073741824; "결과 디스크 여유 부족") |
held("http"; $http.started!=null and $s.epoch-$http.started>=($ENV.HTTP_WINDOW_SECONDS|tonumber) and $ratio!=null and $ratio>=($ENV.HTTP_FAILURE_RATIO|tonumber); ($ENV.HTTP_FAILURE_SUSTAIN_SECONDS|tonumber); "최근 1분 HTTP 실패율 기준 초과 지속") |
raise(($http.errors // 0)>0; "k6 expected_response 태그 누락") |
raise(($http.dropped // 0)>0; "k6 dropped_iterations 발생") |
held("grafana"; $s.grafana.disabled!=true and $s.grafana.database!="ok"; ($ENV.COLLECTION_FAILURE_SECONDS|tonumber); "Grafana Health 장애 지속") |
held("hpa"; $s.hpa.spec.maxReplicas!=null and $s.hpa.status.currentReplicas >= $s.hpa.spec.maxReplicas and $hpaCPU!=null and $hpaTarget!=null and $hpaCPU >= $hpaTarget; ($ENV.HPA_SATURATION_SECONDS|tonumber); "HPA 최대 Replica에서 CPU 포화 지속") |
.reasons |= unique |
.preflight_ok=($clusterOK and $upOK and $s.hpa.kind=="HorizontalPodAutoscaler" and $hpaCPU!=null and $hpaTarget!=null and $apiReady>=($ENV.REQUIRED_BACKEND_READY|tonumber) and $apiReady==($api|length) and all($s.nodes.items[];ready) and (.reasons|length)==0)
