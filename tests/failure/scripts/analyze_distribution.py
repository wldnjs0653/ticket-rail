#!/usr/bin/env python3
"""Analyze traffic distribution, success rate, and phase latency."""

import argparse
import json
import math
from collections import Counter


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", required=True)
    parser.add_argument("--degraded", required=True)
    parser.add_argument("--recovered", required=True)
    parser.add_argument("--transition")
    parser.add_argument("--nodes", default="w1,w2,w3")
    parser.add_argument("--failed-node", default="w2")
    parser.add_argument("--tolerance-pp", type=float, default=5.0)
    parser.add_argument("--failed-node-max-percent", type=float, default=0.5)
    parser.add_argument("--min-success-rate", type=float, default=99.0)
    parser.add_argument("--min-node-identification-rate", type=float, default=99.0)
    parser.add_argument("--endpoint-removal-mode", default="automatic")
    parser.add_argument("--json-output", required=True)
    parser.add_argument("--markdown-output", required=True)
    return parser.parse_args()


def load_rows(path):
    rows = []
    with open(path, encoding="utf-8") as stream:
        for line in stream:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    if not rows:
        raise SystemExit(f"no probe samples in {path}")
    return rows


def percentile(values, fraction):
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, math.ceil(len(ordered) * fraction) - 1))
    return round(ordered[index], 3)


def longest_failure_streak(rows):
    best_count = 0
    best_seconds = 0.0
    current = []
    for row in sorted(rows, key=lambda item: item.get("timestamp", 0)):
        if row.get("ok"):
            current = []
            continue
        current.append(row)
        seconds = 0.0
        if len(current) > 1:
            seconds = current[-1]["timestamp"] - current[0]["timestamp"]
        if len(current) > best_count:
            best_count = len(current)
            best_seconds = seconds
    return {"count": best_count, "seconds": round(best_seconds, 3)}


def summarize(path, nodes):
    rows = load_rows(path)
    successful = [row for row in rows if row.get("ok")]
    identified = [row for row in successful if row.get("node")]
    latencies = [float(row["latency_ms"]) for row in successful]
    counts = Counter(row["node"] for row in identified)
    identified_total = len(identified)
    shares = {
        node: round((counts.get(node, 0) * 100 / identified_total), 3)
        if identified_total
        else 0.0
        for node in nodes
    }
    unexpected = sorted(node for node in counts if node not in nodes)
    return {
        "samples": len(rows),
        "successes": len(successful),
        "failures": len(rows) - len(successful),
        "success_rate_percent": round(len(successful) * 100 / len(rows), 3),
        "identified_successes": identified_total,
        "node_identification_rate_percent": round(
            identified_total * 100 / len(successful), 3
        )
        if successful
        else 0.0,
        "node_counts": {node: counts.get(node, 0) for node in nodes},
        "node_share_percent": shares,
        "unexpected_nodes": unexpected,
        "p50_latency_ms": percentile(latencies, 0.50),
        "p95_latency_ms": percentile(latencies, 0.95),
        "p99_latency_ms": percentile(latencies, 0.99),
        "max_latency_ms": round(max(latencies), 3) if latencies else None,
        "longest_failure_streak": longest_failure_streak(rows),
    }


def distribution_check(summary, expected_nodes, expected_share, tolerance_pp, failed_node=None, failed_max=0.5):
    checks = []
    for node in expected_nodes:
        actual = summary["node_share_percent"].get(node, 0.0)
        checks.append(
            {
                "name": f"{node}_share",
                "expected_percent": round(expected_share, 3),
                "actual_percent": actual,
                "tolerance_pp": tolerance_pp,
                "pass": abs(actual - expected_share) <= tolerance_pp,
            }
        )
    if failed_node:
        actual = summary["node_share_percent"].get(failed_node, 0.0)
        checks.append(
            {
                "name": f"{failed_node}_excluded",
                "expected_percent": 0.0,
                "actual_percent": actual,
                "tolerance_pp": failed_max,
                "pass": actual <= failed_max,
            }
        )
    checks.append(
        {
            "name": "unexpected_nodes",
            "actual": summary["unexpected_nodes"],
            "pass": not summary["unexpected_nodes"],
        }
    )
    return checks


def latency_delta(current, baseline):
    if current is None or baseline is None:
        return {"delta_ms": None, "change_percent": None}
    delta = current - baseline
    change = (delta * 100 / baseline) if baseline else None
    return {
        "delta_ms": round(delta, 3),
        "change_percent": round(change, 3) if change is not None else None,
    }


def fmt(value, suffix=""):
    return "-" if value is None else f"{value}{suffix}"


def main():
    args = parse_args()
    nodes = [node.strip() for node in args.nodes.split(",") if node.strip()]
    if args.failed_node not in nodes:
        raise SystemExit("failed node must be included in --nodes")
    active_nodes = [node for node in nodes if node != args.failed_node]

    phases = {
        "before": summarize(args.baseline, nodes),
        "during": summarize(args.degraded, nodes),
        "after": summarize(args.recovered, nodes),
    }
    if args.transition:
        phases["transition"] = summarize(args.transition, nodes)

    checks = []
    for phase_name in ("before", "during", "after"):
        phase = phases[phase_name]
        checks.extend(
            [
                {
                    "name": f"{phase_name}_success_rate",
                    "actual_percent": phase["success_rate_percent"],
                    "minimum_percent": args.min_success_rate,
                    "pass": phase["success_rate_percent"] >= args.min_success_rate,
                },
                {
                    "name": f"{phase_name}_node_identification_rate",
                    "actual_percent": phase["node_identification_rate_percent"],
                    "minimum_percent": args.min_node_identification_rate,
                    "pass": phase["node_identification_rate_percent"]
                    >= args.min_node_identification_rate,
                },
            ]
        )

    equal_three = 100.0 / len(nodes)
    equal_active = 100.0 / len(active_nodes)
    checks += distribution_check(phases["before"], nodes, equal_three, args.tolerance_pp)
    checks += distribution_check(
        phases["during"],
        active_nodes,
        equal_active,
        args.tolerance_pp,
        failed_node=args.failed_node,
        failed_max=args.failed_node_max_percent,
    )
    checks += distribution_check(phases["after"], nodes, equal_three, args.tolerance_pp)

    comparisons = {
        "during_vs_before_p95": latency_delta(
            phases["during"]["p95_latency_ms"], phases["before"]["p95_latency_ms"]
        ),
        "after_vs_before_p95": latency_delta(
            phases["after"]["p95_latency_ms"], phases["before"]["p95_latency_ms"]
        ),
    }

    result = {
        "status": "PASS" if all(check["pass"] for check in checks) else "FAIL",
        "criteria": {
            "distribution_tolerance_percentage_points": args.tolerance_pp,
            "minimum_success_rate_percent": args.min_success_rate,
            "minimum_node_identification_rate_percent": args.min_node_identification_rate,
            "failed_node_max_percent": args.failed_node_max_percent,
        },
        "endpoint_removal_mode": args.endpoint_removal_mode,
        "nodes": nodes,
        "failed_node": args.failed_node,
        "phases": phases,
        "latency_comparison": comparisons,
        "checks": checks,
    }

    with open(args.json_output, "w", encoding="utf-8") as stream:
        json.dump(result, stream, ensure_ascii=False, indent=2)

    headers = [
        "구간",
        "요청",
        "성공률",
        *nodes,
        "p50",
        "p95",
        "p99",
        "최대",
    ]
    phase_labels = {
        "before": "장애 전",
        "during": "장애 중",
        "after": "복구 후",
        "transition": "전환 전체",
    }
    table_rows = []
    for phase_name in ("before", "during", "after", "transition"):
        if phase_name not in phases:
            continue
        phase = phases[phase_name]
        table_rows.append(
            [
                phase_labels[phase_name],
                str(phase["samples"]),
                f'{phase["success_rate_percent"]}%',
                *[
                    f'{phase["node_share_percent"].get(node, 0.0)}%'
                    for node in nodes
                ],
                fmt(phase["p50_latency_ms"], "ms"),
                fmt(phase["p95_latency_ms"], "ms"),
                fmt(phase["p99_latency_ms"], "ms"),
                fmt(phase["max_latency_ms"], "ms"),
            ]
        )

    with open(args.markdown_output, "w", encoding="utf-8") as stream:
        stream.write("# Application Worker Traffic Distribution Test\n\n")
        stream.write(f"- Result: **{result['status']}**\n")
        stream.write(f"- Failed node: {args.failed_node}\n")
        stream.write(f"- Endpoint removal: {args.endpoint_removal_mode}\n")
        stream.write(
            f"- Distribution tolerance: ±{args.tolerance_pp} percentage points\n"
        )
        stream.write(f"- Minimum success rate: {args.min_success_rate}%\n\n")
        stream.write("| " + " | ".join(headers) + " |\n")
        stream.write("|" + "|".join(["---"] * len(headers)) + "|\n")
        for row in table_rows:
            stream.write("| " + " | ".join(row) + " |\n")

        stream.write("\n## Latency comparison\n\n")
        before_p95 = phases["before"]["p95_latency_ms"]
        during_delta = comparisons["during_vs_before_p95"]
        after_delta = comparisons["after_vs_before_p95"]
        stream.write(f"- Before p95: {fmt(before_p95, 'ms')}\n")
        stream.write(
            f"- During vs before p95: {fmt(during_delta['delta_ms'], 'ms')} "
            f"({fmt(during_delta['change_percent'], '%')})\n"
        )
        stream.write(
            f"- After vs before p95: {fmt(after_delta['delta_ms'], 'ms')} "
            f"({fmt(after_delta['change_percent'], '%')})\n"
        )

        if "transition" in phases:
            streak = phases["transition"]["longest_failure_streak"]
            stream.write("\n## Transition impact\n\n")
            stream.write(f"- Transition failures: {phases['transition']['failures']}\n")
            stream.write(
                f"- Longest consecutive failure streak: {streak['count']} requests, "
                f"{streak['seconds']} seconds\n"
            )

        failed_checks = [check for check in checks if not check["pass"]]
        stream.write("\n## Failed criteria\n\n")
        if failed_checks:
            for check in failed_checks:
                stream.write(f"- {check['name']}: {json.dumps(check, ensure_ascii=False)}\n")
        else:
            stream.write("- None\n")

    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()