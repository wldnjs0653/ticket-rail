#!/bin/bash
# =====================================
#@file		node_backend_tunnels.sh
#@date		2026-09-08
#@desc		백엔드 로컬 개발용 port-forward 터널 (PG / Redis / Kafka)
##			- 백엔드 E2E 및 DBeaver 접속용 스크립트
#@usage		/root/ticketing-node-repo/node_backend_tunnels.sh
M=https://10.1.93.62:6443
while true; do kubectl --server=$M port-forward pod/ticketing-postgresql-1 -n data 5432:5432 --address=0.0.0.0; sleep 1; done &
while true; do kubectl --server=$M port-forward pod/redis-0 -n data 6379:6379 --address=0.0.0.0; sleep 1; done &
while true; do kubectl --server=$M port-forward svc/ticketing-kafka-kafka-bootstrap -n data 9092:9092 --address=0.0.0.0; sleep 1; done &
wait

