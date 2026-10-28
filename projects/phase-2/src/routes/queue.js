// @author gyustar
// @date 2026-10-01

// F01 — Queue (대기열) 라우트
//
// Redis INCR로 이벤트별 고유 순번을 발급하고, Sorted Set에 토큰을 순서대로
// 저장한다. 실제 입장 판정은 auth.js에서 Lua 스크립트로 원자적으로 처리한다.

const express = require('express');
const crypto = require('crypto');
const redis = require('../clients/redisClient');
const config = require('../config');
const idempotency = require('../middleware/idempotency');
const {
  joinQueue,
  leaveQueue,
} = require('../services/queueAdmission');

const router = express.Router();
const QUEUE_TOKEN_TTL_SECONDS = config.queueTokenTtlSeconds;

// POST /queue/join { event_id, user_id }
router.post('/join', idempotency(), async (req, res) => {
  const { event_id, user_id } = req.body || {};

  if (!event_id || !user_id) {
    return res.status(400).json({ error: 'event_id and user_id are required' });
  }

  // 같은 Idempotency-Key의 재시도는 같은 토큰을 사용한다.
  const token = crypto
    .createHash('sha256')
    .update(`${event_id}:${user_id}:${req.get('Idempotency-Key')}`)
    .digest('hex');
  const issuedAt = new Date().toISOString();
  const position = await joinQueue(redis, {
    eventId: event_id,
    userId: user_id,
    token,
    issuedAt,
    tokenTtlSeconds: QUEUE_TOKEN_TTL_SECONDS,
  });

  return res.status(202).json({
    status: 'queued',
    event_id,
    position,
    token,
    retry_after_seconds: 1,
    token_ttl_seconds: QUEUE_TOKEN_TTL_SECONDS,
  });
});

// POST /queue/leave { event_id, token }
//
// 사용자가 명시적으로 대기실을 나가면 대기 토큰과 입장 점유를 즉시 반환한다.
// 브라우저가 비정상 종료된 경우에는 기존 TTL이 최종 안전장치로 동작한다.
router.post('/leave', async (req, res) => {
  const { event_id, token } = req.body || {};

  if (!event_id || !token) {
    return res.status(400).json({ error: 'event_id and token are required' });
  }

  const removed = await leaveQueue(redis, {
    eventId: event_id,
    token,
  });

  return res.status(200).json({
    status: 'left',
    event_id,
    removed: removed === 1,
  });
});

module.exports = router;