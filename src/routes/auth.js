// @author gyustar
// @date 2026-09-03 (2026-09-16 : 동시 입장 정원 제한 + 지표 추가)
//                  (2026-09-17 : 입장 허가 키 TTL 기준 수정, queue_waiting 지표 제거)

// F02 — Auth (입장 허용 확인) 라우트
//
// queue.js에서 받은 토큰이 진짜인지, 아직 유효한지 확인하고
// "이 사람 입장시켜도 됩니다"라는 도장을 찍어주는 곳.
//
// 참고: 여기서 말하는 "인증(Auth)"은 아이디/비밀번호 로그인이 아니라,
// "대기열을 정상적으로 통과했는가"를 확인하는 절차다. 실제 로그인 시스템은
// 이 프로젝트 범위 밖이다 (README에도 명시되어 있다).
//
// 2026-09-16 추가: 토큰만 맞으면 무조건 입장시키던 기존 방식에 "동시 입장
// 정원"을 얹었다. 이벤트별로 현재 입장 인원을 세어, 정원을 넘으면 신규
// 사용자는 대기(202) 상태로 돌려보낸다.
//
// 알려진 한계 (1차 범위 밖):
//   - 입장 판정에 발급 순번(position)을 쓰지 않는다 → 선착순을 보장하지 않는다
//   - 정원 확인(ZCARD)과 등록(ZADD)이 분리돼 있어 동시 요청 시 정원을 넘을 수 있다

const express = require('express');
const redis = require('../clients/redisClient');
const config = require('../config');
const {
  queueAdmittedTotal,
  queueRejectedTotal,
  queueWaitSeconds,
} = require('../metrics');

const router = express.Router();

// 동시 입장 정원과 입장 허가 유효시간은 config에서 읽는다.
const ADMISSION_LIMIT = config.queueAdmissionLimit;
const ADMISSION_TTL_MS = config.admissionTtlSeconds * 1000;

// 입장이 발생한 이벤트 ID 목록. metrics.js가 스크랩 때 이 목록만 조회한다.
const ADMISSION_EVENTS_KEY = 'queue:admission:events';

// POST /auth/verify { event_id, token }
//
// 처리 순서:
//   1) queue.js가 만들어둔 토큰이 Redis에 아직 살아있는지 확인
//   2) 없다면(유효기간 지났거나 애초에 없는 토큰) 401 에러로 거부
//   3) 있다면 현재 입장 인원을 확인 — 정원 미만이면 입장, 초과면 대기(202)
//   4) 입장 허용 시 "입장 허용됨" 표시를 Redis에 남긴다
//      -> 이 표시는 다음 단계(seat.js의 좌석 Hold)에서 다시 확인한다
router.post('/verify', async (req, res) => {
  const { event_id, token } = req.body || {};

  if (!event_id || !token) {
    return res.status(400).json({ error: 'event_id and token are required' });
  }

  // queue.js에서 저장했던 것과 정확히 같은 키 형식으로 조회해야 값을 찾을 수 있다.
  const tokenKey = `queue:${event_id}:token:${token}`;
  const raw = await redis.get(tokenKey);

  if (!raw) {
    // 토큰이 없다는 건 — 유효기간이 지났거나, 애초에 존재하지 않는(가짜) 토큰이라는 뜻.
    return res.status(401).json({ error: 'invalid_or_expired_token' });
  }

  // issued_at은 대기열 진입 시각(ISO 문자열)으로, 대기시간 지표 계산에 쓴다.
  const data = JSON.parse(raw);
  const eventLabel = { event_id: String(event_id) };

  // ── 동시 입장 정원 확인 ────────────────────────────────────
  //
  // 입장 중인 사람을 Sorted Set으로 관리한다.
  //   member = user_id, score = 최초 입장 시각(ms)
  // score를 최초 입장 시각으로 고정하면, 만료된 사람만 골라 빼기 쉽고
  // (ZREMRANGEBYSCORE), 재확인해도 자리 점유가 연장되지 않는다.
  const admittedSetKey = `queue:${event_id}:admitted:set`;
  const now = Date.now();

  // 1) 유효기간이 지난 입장자를 먼저 제거한다 — 이만큼 자리가 반환된다.
  await redis.zremrangebyscore(admittedSetKey, 0, now - ADMISSION_TTL_MS);

  // 2) 이미 입장한 사용자인지 확인한다. 이미 들어와 있으면 그대로 통과시킨다.
  const alreadyIn = await redis.zscore(admittedSetKey, String(data.user_id));

  // 최초 입장 시각. 입장 허가 키의 남은 유효시간 계산에 쓴다.
  let admittedAt;

  if (alreadyIn === null) {
    // 신규 입장 시도 — 현재 입장 인원이 정원 미만일 때만 받아준다.
    const currentCount = await redis.zcard(admittedSetKey);

    if (currentCount >= ADMISSION_LIMIT) {
      // 정원이 찼다. 오류가 아니라 "지금은 대기해야 한다"는 정상 상태라 202로 응답한다.
      await redis.incr(`queue:${event_id}:reject_count`);

      // 지표: 정원 초과 건수 누적
      // (2026-09-17) queue_waiting 기록 제거 — 대기자 수가 아닌 입장자 수가 기록되던 문제.
      //              현재 입장자 수는 metrics.js의 admitted_current가 스크랩 시점에 조회한다.
      queueRejectedTotal.inc(eventLabel);

      const retryAfter = currentCount >= ADMISSION_LIMIT * 5 ? 10 : 5;
      return res.status(202).json({
        status: 'waiting',
        event_id,
        user_id: data.user_id,
        admission_limit: ADMISSION_LIMIT,
        current_admitted: currentCount,
        retry_after_seconds: retryAfter,
      });
    }

    // 정원 여유 있음 — 입장자로 등록한다. NX로 최초 입장 시각만 기록한다.
    await redis.zadd(admittedSetKey, 'NX', now, String(data.user_id));
    await redis.sadd(ADMISSION_EVENTS_KEY, String(event_id));
    admittedAt = now;

    // 지표: 입장 허용 누적 + 진입~입장 대기시간 기록
    queueAdmittedTotal.inc(eventLabel);
    if (data.issued_at) {
      const waited = (now - new Date(data.issued_at).getTime()) / 1000;
      if (waited >= 0) queueWaitSeconds.observe(eventLabel, waited);
    }
  } else {
    admittedAt = Number(alreadyIn);
  }

  // ── 입장 허용 표시 ────────────────────────────────────────
  // seat.js의 좌석 Hold 요청이 들어왔을 때, 이 표시가 있는 사람만 통과시킨다.
  //
  // (2026-09-17) 이전에는 Verify마다 전체 TTL로 다시 설정해서, Sorted Set(최초 입장 기준)과
  // 유효기간이 어긋났다. 최초 입장 시각 기준 "남은 시간"으로 설정해 두 상태를 맞춘다.
  const admissionKey = `queue:${event_id}:admitted:${data.user_id}`;
  const remainingMs = Math.max(admittedAt + ADMISSION_TTL_MS - now, 1);
  await redis.set(admissionKey, '1', 'PX', remainingMs);

  return res.status(200).json({
    status: 'admitted',
    event_id,
    user_id: data.user_id,
    position: data.position,
  });
});

module.exports = router;