# Read k6 JSON output as a stream; bounded 60-second buckets, no raw-point file.
foreach inputs as $p (
  {b:{}, dropped:0, errors:0, started:null, emitted:-1, emit:false};
  .emit=false |
  if $p.type=="Point" and (["http_reqs","dropped_iterations","watch_scenario_start_ms"]|index($p.metric))!=null then
    ($p.data.time|sub("\\.[0-9]+Z$";"Z")|fromdateiso8601) as $t |
    if $p.metric=="watch_scenario_start_ms" then .started=($p.data.value/1000)
    elif $p.metric=="dropped_iterations" then .dropped+=$p.data.value
    else
      ($t|tostring) as $key |
      .b[$key] //= {t:$t,n:0,f:0} |
      .b[$key].n += $p.data.value |
      if $p.data.tags.expected_response=="false" then .b[$key].f += $p.data.value
      elif $p.data.tags.expected_response!="true" then .errors+=1 else . end
    end |
    .b |= with_entries(select(.value.t >= $t-60)) |
    if $t>.emitted or $p.metric=="dropped_iterations" or .errors>0 then .emitted=$t | .emit=true else . end
  else . end;
  if .emit then del(.emit) else empty end
)
