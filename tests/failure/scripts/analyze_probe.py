#!/usr/bin/env python3
import argparse
import json
import math

parser = argparse.ArgumentParser()
parser.add_argument("--input", required=True)
parser.add_argument("--stable-successes", type=int, default=5)
parser.add_argument("--fault-time-ms", type=int)
args = parser.parse_args()

rows = []
with open(args.input, encoding="utf-8") as stream:
    for line in stream:
        line = line.strip()
        if line:
            rows.append(json.loads(line))

if not rows:
    raise SystemExit("probe file contains no samples")

baseline_rows = []
if args.fault_time_ms is not None:
    fault_time_seconds = args.fault_time_ms / 1000
    baseline_rows = [row for row in rows if row["timestamp"] < fault_time_seconds]
baseline_failures = sum(1 for row in baseline_rows if not row.get("ok"))
baseline_valid = args.fault_time_ms is None or (
    len(baseline_rows) > 0 and baseline_failures == 0
)

failures = [index for index, row in enumerate(rows) if not row.get("ok")]
latencies = sorted(float(row.get("latency_ms", 0)) for row in rows)
first_failure_index = failures[0] if failures else None
last_failure_index = failures[-1] if failures else None
first_success_after_failure_index = None
recovery_index = None

if first_failure_index is not None:
    for index in range(first_failure_index + 1, len(rows)):
        if rows[index].get("ok"):
            first_success_after_failure_index = index
            break
    stable = args.stable_successes
    stable_start = last_failure_index + 1
    stable_end = stable_start + stable
    if stable_end <= len(rows) and all(rows[pos].get("ok") for pos in range(stable_start, stable_end)):
        recovery_index = stable_end - 1

failure_windows = []
index = 0
while index < len(rows):
    if rows[index].get("ok"):
        index += 1
        continue
    start = index
    while index + 1 < len(rows) and not rows[index + 1].get("ok"):
        index += 1
    end = index
    recovery_boundary = end + 1 if end + 1 < len(rows) else end
    failure_windows.append({
        "start_iso": rows[start]["iso"],
        "end_iso": rows[recovery_boundary]["iso"],
        "duration_seconds": round(
            rows[recovery_boundary]["timestamp"] - rows[start]["timestamp"], 3
        ),
        "failure_count": end - start + 1,
    })
    index += 1

def percentile(values, fraction):
    if not values:
        return 0.0
    position = min(len(values) - 1, max(0, math.ceil(len(values) * fraction) - 1))
    return round(values[position], 3)

recovery_seconds = None
if first_failure_index is not None and recovery_index is not None:
    recovery_seconds = round(
        rows[recovery_index]["timestamp"] - rows[first_failure_index]["timestamp"], 3
    )

if not baseline_valid:
    state = "invalid_baseline"
elif first_failure_index is None:
    state = "failure_not_observed"
elif recovery_index is None:
    state = "recovery_unconfirmed"
else:
    state = "recovered"

summary = {
    "state": state,
    "valid": baseline_valid,
    "baseline_samples": len(baseline_rows),
    "baseline_failures": baseline_failures,
    "samples": len(rows),
    "successes": len(rows) - len(failures),
    "failures": len(failures),
    "error_rate_percent": round(len(failures) * 100 / len(rows), 3),
    "p95_latency_ms": percentile(latencies, 0.95),
    "max_latency_ms": round(max(latencies), 3),
    "first_failure_iso": rows[first_failure_index]["iso"] if first_failure_index is not None else None,
    "first_success_after_failure_iso": rows[first_success_after_failure_index]["iso"] if first_success_after_failure_index is not None else None,
    "recovery_iso": rows[recovery_index]["iso"] if recovery_index is not None else None,
    "recovery_seconds": recovery_seconds,
    "failure_windows": failure_windows,
    "total_failure_seconds": round(sum(item["duration_seconds"] for item in failure_windows), 3),
    "refailure_window_count": max(0, len(failure_windows) - 1),
    "stable_successes_required": args.stable_successes,
    "recovered": baseline_valid and (first_failure_index is None or recovery_index is not None),
}
print(json.dumps(summary, ensure_ascii=False))
if not summary["recovered"]:
    raise SystemExit(2)

