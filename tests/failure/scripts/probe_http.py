#!/usr/bin/env python3
import argparse
import http.client
import json
import os
import socket
import ssl
import time
import urllib.parse
from datetime import datetime, timezone

parser = argparse.ArgumentParser()
parser.add_argument("--url", required=True)
parser.add_argument("--host-header")
parser.add_argument("--connect-ip")
parser.add_argument("--tls-verify", choices=("true", "false"), default="true")
parser.add_argument("--interval", type=float, default=0.5)
parser.add_argument("--timeout", type=float, default=2.0)
parser.add_argument("--max-duration", type=float, default=300.0)
parser.add_argument("--stop-file")
parser.add_argument("--output", required=True)
args = parser.parse_args()

tls_context = None
parsed_url = urllib.parse.urlsplit(args.url)
if parsed_url.scheme not in ("http", "https") or not parsed_url.hostname:
    raise SystemExit("--url은 http:// 또는 https:// 호스트를 포함해야 합니다.")
if parsed_url.scheme == "https":
    tls_context = (ssl.create_default_context() if args.tls_verify == "true"
                   else ssl._create_unverified_context())

connect_host = args.connect_ip or parsed_url.hostname
connect_port = parsed_url.port or (443 if parsed_url.scheme == "https" else 80)
request_target = parsed_url.path or "/"
if parsed_url.query:
    request_target += "?" + parsed_url.query
request_host = args.host_header or parsed_url.netloc

started = time.monotonic()
os.makedirs(os.path.dirname(args.output), exist_ok=True)

with open(args.output, "w", encoding="utf-8") as stream:
    while time.monotonic() - started < args.max_duration:
        if args.stop_file and os.path.exists(args.stop_file):
            break
        wall = time.time()
        begin = time.monotonic()
        status = None
        body = ""
        error = ""
        ok = False
        connection = None
        try:
            connection = http.client.HTTPConnection(
                connect_host, connect_port, timeout=args.timeout)
            if parsed_url.scheme == "https":
                raw_socket = socket.create_connection(
                    (connect_host, connect_port), timeout=args.timeout)
                connection.sock = tls_context.wrap_socket(
                    raw_socket, server_hostname=parsed_url.hostname)
            connection.request("GET", request_target, headers={"Host": request_host})
            response = connection.getresponse()
            status = response.status
            body = response.read(512).decode("utf-8", "replace")
            ok = 200 <= status < 300
        except Exception as exc:
            error = f"{type(exc).__name__}: {exc}"
        finally:
            if connection is not None:
                connection.close()
        row = {
            "timestamp": wall,
            "iso": datetime.fromtimestamp(wall, timezone.utc).isoformat(),
            "ok": ok,
            "status": status,
            "latency_ms": round((time.monotonic() - begin) * 1000, 3),
            "body": body,
            "error": error,
        }
        stream.write(json.dumps(row, ensure_ascii=False) + "\n")
        stream.flush()
        time.sleep(args.interval)

