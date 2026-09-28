#!/usr/bin/env python3
import argparse
import json
import os
import subprocess
import time
from datetime import datetime, timezone

parser = argparse.ArgumentParser()
parser.add_argument("--interval", type=float, default=0.5)
parser.add_argument("--timeout", type=float, default=3.0)
parser.add_argument("--max-duration", type=float, default=300.0)
parser.add_argument("--stop-file")
parser.add_argument("--output", required=True)
parser.add_argument("command", nargs=argparse.REMAINDER)
args = parser.parse_args()

command = args.command
if command and command[0] == "--":
    command = command[1:]
if not command:
    raise SystemExit("a command is required after --")

started = time.monotonic()
os.makedirs(os.path.dirname(args.output), exist_ok=True)

with open(args.output, "w", encoding="utf-8") as stream:
    while time.monotonic() - started < args.max_duration:
        if args.stop_file and os.path.exists(args.stop_file):
            break
        wall = time.time()
        begin = time.monotonic()
        ok = False
        stdout = ""
        stderr = ""
        rc = None
        try:
            completed = subprocess.run(
                command,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=args.timeout,
                check=False,
            )
            rc = completed.returncode
            stdout = completed.stdout[-512:]
            stderr = completed.stderr[-512:]
            ok = rc == 0
        except Exception as exc:
            stderr = f"{type(exc).__name__}: {exc}"
        row = {
            "timestamp": wall,
            "iso": datetime.fromtimestamp(wall, timezone.utc).isoformat(),
            "ok": ok,
            "rc": rc,
            "latency_ms": round((time.monotonic() - begin) * 1000, 3),
            "stdout": stdout,
            "stderr": stderr,
        }
        stream.write(json.dumps(row, ensure_ascii=False) + "\n")
        stream.flush()
        time.sleep(args.interval)

