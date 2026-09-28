// routes/health.js
const express = require('express');
const pgPool = require('../clients/pgClient');
const redis = require('../clients/redisClient');

const router = express.Router();

// 의존성 체크가 probe 타임아웃을 넘기지 않도록 상한을 건다
const CHECK_TIMEOUT_MS = 1500;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout ${ms}ms`)), ms)
    ),
  ]);
}

/**
 * Liveness — 프로세스가 살아있는지만 본다.
 * 의존성(PG/Redis/Kafka)을 절대 체크하지 않는다.
 * 여기서 DB를 보면 DB 순단에 Pod가 통째로 재시작되는 루프에 빠진다.
 */
router.get('/live', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
  });
});

/**
 * Readiness — 트래픽을 받을 수 있는 상태인지 본다.
 * PG / Redis 둘 다 정상이어야 200. 하나라도 실패하면 503으로 Service에서 빠진다.
 * Kafka는 의도적으로 제외 — booking.created 발행이 실패해도 예약 확정은 유지되는 설계라,
 * Kafka 장애로 API 전체를 내리면 오히려 가용성이 떨어진다.
 */
router.get('/ready', async (req, res) => {
  const checks = {};

  const results = await Promise.allSettled([
    withTimeout(pgPool.query('SELECT 1'), CHECK_TIMEOUT_MS, 'postgres'),
    withTimeout(redis.ping(), CHECK_TIMEOUT_MS, 'redis'),
  ]);

  const [pgResult, redisResult] = results;

  checks.postgres =
    pgResult.status === 'fulfilled'
      ? { status: 'up' }
      : { status: 'down', error: pgResult.reason.message };

  checks.redis =
    redisResult.status === 'fulfilled'
      ? { status: 'up' }
      : { status: 'down', error: redisResult.reason.message };

  const healthy = Object.values(checks).every((c) => c.status === 'up');

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ready' : 'not_ready',
    checks,
  });
});

module.exports = router;
