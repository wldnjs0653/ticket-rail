// @author gyustar
// @date 2026-10-01

// F02 — Auth (대기열 입장 허용 확인) 라우트
//
// 토큰 유효성, 선착순, 현재 입장 정원 확인과 신규 입장자 등록을 Redis Lua
// 스크립트 하나로 처리한다. 여러 Backend Pod가 동시에 요청을 처리해도
// QUEUE_ADMISSION_LIMIT을 넘지 않는다.

const express = require('express');
const redis = require('../clients/redisClient');
const config = require('../config');
const {
  queueAdmittedTotal,
  queueRejectedTotal,
  queueWaitSeconds,
} = require('../metrics');
const { verifyQueueToken } = require('../services/queueAdmission');

const router = express.Router();
const ADMISSION_LIMIT = config.queueAdmissionLimit;
const ADMISSION_TTL_SECONDS = config.admissionTtlSeconds;

// POST /auth/verify { event_id, token }
router.post('/verify', async (req, res) => {
  const { event_id, token } = req.body || {};

  if (!event_id || !token) {
    return res.status(400).json({ error: 'event_id and token are required' });
  }

  const result = await verifyQueueToken(redis, {
    eventId: event_id,
    token,
    admissionLimit: ADMISSION_LIMIT,
    admissionTtlSeconds: ADMISSION_TTL_SECONDS,
  });

  if (result.status === 'invalid') {
    return res.status(401).json({ error: 'invalid_or_expired_token' });
  }

  const eventLabel = { event_id: String(event_id) };

  if (result.status === 'waiting') {
    queueRejectedTotal.inc(eventLabel);
    const retryAfter = result.waitingPosition > ADMISSION_LIMIT * 5 ? 5 : 2;

    return res.status(202).json({
      status: 'waiting',
      event_id,
      user_id: result.userId,
      position: result.originalPosition,
      waiting_position: result.waitingPosition,
      total_waiting: result.totalWaiting,
      admission_limit: ADMISSION_LIMIT,
      current_admitted: result.currentAdmitted,
      retry_after_seconds: retryAfter,
      token_ttl_seconds: Math.ceil(result.remainingMs / 1000),
    });
  }

  if (result.newlyAdmitted) {
    queueAdmittedTotal.inc(eventLabel);
    if (result.issuedAt) {
      const waited = (Date.now() - new Date(result.issuedAt).getTime()) / 1000;
      if (Number.isFinite(waited) && waited >= 0) {
        queueWaitSeconds.observe(eventLabel, waited);
      }
    }
  }

  return res.status(200).json({
    status: 'admitted',
    event_id,
    user_id: result.userId,
    position: result.originalPosition,
    admission_limit: ADMISSION_LIMIT,
    current_admitted: result.currentAdmitted,
    admission_ttl_seconds: Math.ceil(result.remainingMs / 1000),
  });
});

module.exports = router;