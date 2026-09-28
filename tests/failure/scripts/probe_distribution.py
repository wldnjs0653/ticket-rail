#!/usr/bin/env python3
"""Generate fixed-rate HTTP traffic and record the serving Kubernetes node."""

import argparse
import concurrent.futures
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--host-header")
    parser.add_argument("--phase", required=True)
    parser.add_argument("--duration", type=float, default=60.0)
    parser.add_argument("--rate", type=float, default=20.0)
    parser.add_argument("--concurrency", type=int, default=40)
    parser.add_argument("--timeout", type=float, default=3.0)
    parser.add_argument("--stop-file")
    parser.add_argument("--output", required=True)
    return parser.parse_args()


def add_request_id(url, request_id):
    parts = urllib.parse.urlsplit(url)
    query = urllib.parse.parse_qsl(parts.query, keep_blank_values=True)
    query.append(("ha_probe_id", str(request_id)))
    return urllib.parse.urlunsplit(
        (parts.scheme, parts.netloc, parts.path, urllib.parse.urlencode(query), parts.fragment)
    )


def request_once(args, request_id):
    wall = time.time()
    started = time.monotonic()
    status = None
    body = ""
    error = ""
    node = None
    pod = None
    try:
        request = urllib.request.Request(add_request_id(args.url, request_id))
        if args.host_header:
            request.add_header("Host", args.host_header)
        request.add_header("Connection", "close")
        request.add_header("Cache-Control", "no-store")
        with urllib.request.urlopen(request, timeout=args.timeout) as response:
            status = response.status
            body = response.read(2048).decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        status = exc.code
        error = str(exc)
        try:
            body = exc.read(2048).decode("utf-8", "replace")
        except Exception:
            pass
    except Exception as exc:
        error = f"{type(exc).__name__}: {exc}"

    node_match = re.search(r"(?m)^node=([^\s]+)$", body)
    pod_match = re.search(r"(?m)^pod=([^\s]+)$", body)
    if node_match:
        node = node_match.group(1)
    if pod_match:
        pod = pod_match.group(1)
    http_ok = status is not None and 200 <= status < 400
    return {
        "request_id": request_id,
        "phase": args.phase,
        "timestamp": wall,
        "iso": datetime.fromtimestamp(wall, timezone.utc).isoformat(),
        "ok": bool(http_ok),
        "node_identified": node is not None,
        "status": status,
        "node": node,
        "pod": pod,
        "latency_ms": round((time.monotonic() - started) * 1000, 3),
        "error": error,
    }


def main():
    args = parse_args()
    if args.rate <= 0 or args.duration <= 0 or args.concurrency <= 0:
        raise SystemExit("duration, rate, and concurrency must be positive")

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    started = time.monotonic()
    total = int(args.duration * args.rate)
    futures = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrency) as executor:
        for request_id in range(total):
            if args.stop_file and os.path.exists(args.stop_file):
                break
            target = started + request_id / args.rate
            delay = target - time.monotonic()
            if delay > 0:
                time.sleep(delay)
            futures.append(executor.submit(request_once, args, request_id))

        rows = [future.result() for future in concurrent.futures.as_completed(futures)]

    rows.sort(key=lambda row: row["request_id"])
    with open(args.output, "w", encoding="utf-8") as stream:
        for row in rows:
            stream.write(json.dumps(row, ensure_ascii=False) + "\n")

    print(json.dumps({"phase": args.phase, "samples": len(rows), "output": args.output}, ensure_ascii=False))


if __name__ == "__main__":
    main()