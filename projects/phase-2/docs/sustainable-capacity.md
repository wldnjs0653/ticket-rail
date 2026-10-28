# Hybrid E2E sustainable capacity

## Final decision

- Sustainable E2E capacity: **60 RPS**
- Recommended normal operating target: **50–55 RPS**
- Validated duration: 180 seconds
- Successful flows: 10,800
- HTTP failures: 0
- Dropped iterations: 0
- Final payment and notification lag: 0
- Async drain: 10 seconds
- 70 RPS: burst/eventual-processing capacity only

## Validated configuration

| Component | Setting |
|---|---:|
| `booking.created` partitions | 48 |
| `payment.completed` partitions | 36 |
| Payment concurrency | 4 |
| Notification concurrency | 3 |
| Payment KEDA per cluster | 1–6 |
| Notification KEDA per cluster | 1–6 |
| PostgreSQL pool per consumer pod | 3 |
| Success log sampling | 1 per 100 |

Payment and notification consumers run as separate Deployments. The API
Backend does not start embedded Kafka consumers.

At 60 RPS, payment lag, notification lag, and both database backlogs had
negative steady-state slopes. At 70 RPS, payment lag increased while load
was active, so 70 RPS is not classified as indefinitely sustainable.
