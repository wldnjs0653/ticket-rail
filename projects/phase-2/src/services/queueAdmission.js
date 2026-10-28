// Redis 대기열의 선착순 입장 판정을 한 곳에 모은 서비스.
//
// 입장 정원 확인과 입장자 등록을 Lua 스크립트 하나로 처리한다.
// Redis는 Lua 스크립트를 원자적으로 실행하므로 여러 Backend Pod가 동시에
// /auth/verify를 처리해도 정원을 초과하거나 뒤 순번이 먼저 들어가지 않는다.

const JOIN_QUEUE_SCRIPT = `
local existing = redis.call('GET', KEYS[2])
if existing then
  local existingPayload = cjson.decode(existing)
  return tonumber(existingPayload.position)
end

local position = redis.call('INCR', KEYS[1])
local payload = cjson.encode({
  user_id = ARGV[1],
  position = position,
  issued_at = ARGV[2]
})

redis.call('SET', KEYS[2], payload, 'EX', ARGV[3])
redis.call('ZADD', KEYS[3], position, ARGV[4])
redis.call('EXPIRE', KEYS[1], ARGV[3])
redis.call('EXPIRE', KEYS[3], ARGV[3])

return position
`;

const VERIFY_QUEUE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  return {'invalid'}
end

local data = cjson.decode(raw)
local userId = tostring(data.user_id)
local originalPosition = tonumber(data.position) or 0
local now = tonumber(ARGV[1])
local admissionTtlMs = tonumber(ARGV[2])
local admissionLimit = tonumber(ARGV[3])
local token = ARGV[4]
local tokenKeyPrefix = ARGV[5]

redis.call('ZREMRANGEBYSCORE', KEYS[3], 0, now - admissionTtlMs)

-- 만료 토큰이 선두에 남아 뒤 사용자를 막지 않도록 한 번에 최대 100개 정리한다.
for index = 1, 100 do
  local head = redis.call('ZRANGE', KEYS[2], 0, 0)
  if #head == 0 then
    break
  end
  if redis.call('EXISTS', tokenKeyPrefix .. head[1]) == 1 then
    break
  end
  redis.call('ZREM', KEYS[2], head[1])
end

local alreadyAdmittedAt = redis.call('ZSCORE', KEYS[3], userId)
if alreadyAdmittedAt then
  local remainingMs = math.max(
    1,
    math.floor(tonumber(alreadyAdmittedAt) + admissionTtlMs - now)
  )
  redis.call('SET', KEYS[4], '1', 'PX', remainingMs)
  redis.call('ZREM', KEYS[2], token)
  return {
    'admitted',
    tostring(redis.call('ZCARD', KEYS[3])),
    tostring(originalPosition),
    '0',
    tostring(redis.call('ZCARD', KEYS[2])),
    tostring(remainingMs),
    '0'
  }
end

local rank = redis.call('ZRANK', KEYS[2], token)
if not rank then
  -- 배포 전에 발급된 토큰도 기존 position으로 대기열에 복원한다.
  redis.call('ZADD', KEYS[2], 'NX', originalPosition, token)
  rank = redis.call('ZRANK', KEYS[2], token)
end

local currentAdmitted = redis.call('ZCARD', KEYS[3])
local availableSlots = admissionLimit - currentAdmitted

if rank and availableSlots > 0 and rank < availableSlots then
  redis.call('ZADD', KEYS[3], 'NX', now, userId)
  redis.call('ZREM', KEYS[2], token)
  redis.call('SADD', KEYS[5], ARGV[6])
  redis.call('SET', KEYS[4], '1', 'PX', admissionTtlMs)

  return {
    'admitted',
    tostring(redis.call('ZCARD', KEYS[3])),
    tostring(originalPosition),
    '0',
    tostring(redis.call('ZCARD', KEYS[2])),
    tostring(admissionTtlMs),
    '1'
  }
end

redis.call('INCR', KEYS[6])
return {
  'waiting',
  tostring(currentAdmitted),
  tostring(originalPosition),
  tostring((rank or 0) + 1),
  tostring(redis.call('ZCARD', KEYS[2])),
  tostring(redis.call('PTTL', KEYS[1])),
  '0'
}
`;

const LEAVE_QUEUE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  redis.call('ZREM', KEYS[2], ARGV[1])
  return 0
end

local data = cjson.decode(raw)
local userId = tostring(data.user_id)
redis.call('ZREM', KEYS[2], ARGV[1])
redis.call('ZREM', KEYS[3], userId)
redis.call('DEL', ARGV[2] .. userId)
redis.call('DEL', KEYS[1])
return 1
`;

function queueKeys(eventId, token) {
  const prefix = `queue:${eventId}`;
  return {
    sequence: `${prefix}:seq`,
    token: `${prefix}:token:${token}`,
    tokenPrefix: `${prefix}:token:`,
    waiting: `${prefix}:waiting`,
    admitted: `${prefix}:admitted:set`,
    admissionPrefix: `${prefix}:admitted:`,
    rejected: `${prefix}:reject_count`,
  };
}

async function joinQueue(redis, {
  eventId,
  userId,
  token,
  issuedAt,
  tokenTtlSeconds,
}) {
  const keys = queueKeys(eventId, token);
  const position = await redis.eval(
    JOIN_QUEUE_SCRIPT,
    3,
    keys.sequence,
    keys.token,
    keys.waiting,
    String(userId),
    issuedAt,
    String(tokenTtlSeconds),
    token
  );
  return Number(position);
}

function normalizeVerificationResult(result) {
  const status = String(result?.[0] || 'invalid');
  if (status === 'invalid') return { status: 'invalid' };

  return {
    status,
    currentAdmitted: Number(result[1] || 0),
    originalPosition: Number(result[2] || 0),
    waitingPosition: Number(result[3] || 0),
    totalWaiting: Number(result[4] || 0),
    remainingMs: Math.max(0, Number(result[5] || 0)),
    newlyAdmitted: String(result[6] || '0') === '1',
  };
}

async function verifyQueueToken(redis, {
  eventId,
  token,
  admissionLimit,
  admissionTtlSeconds,
}) {
  const keys = queueKeys(eventId, token);
  const raw = await redis.get(keys.token);
  if (!raw) return { status: 'invalid' };

  let tokenData;
  try {
    tokenData = JSON.parse(raw);
  } catch {
    return { status: 'invalid' };
  }

  const rawResult = await redis.eval(
    VERIFY_QUEUE_SCRIPT,
    6,
    keys.token,
    keys.waiting,
    keys.admitted,
    `${keys.admissionPrefix}${tokenData.user_id}`,
    'queue:admission:events',
    keys.rejected,
    String(Date.now()),
    String(admissionTtlSeconds * 1000),
    String(admissionLimit),
    token,
    keys.tokenPrefix,
    String(eventId)
  );

  return {
    ...normalizeVerificationResult(rawResult),
    userId: tokenData.user_id,
    issuedAt: tokenData.issued_at,
  };
}

async function leaveQueue(redis, { eventId, token }) {
  const keys = queueKeys(eventId, token);
  return Number(await redis.eval(
    LEAVE_QUEUE_SCRIPT,
    3,
    keys.token,
    keys.waiting,
    keys.admitted,
    token,
    keys.admissionPrefix
  ));
}

async function releaseAdmission(redis, { eventId, userId }) {
  const keys = queueKeys(eventId, 'unused');
  const pipeline = redis.multi();
  pipeline.zrem(keys.admitted, String(userId));
  pipeline.del(`${keys.admissionPrefix}${userId}`);
  await pipeline.exec();
}

module.exports = {
  JOIN_QUEUE_SCRIPT,
  VERIFY_QUEUE_SCRIPT,
  LEAVE_QUEUE_SCRIPT,
  queueKeys,
  joinQueue,
  normalizeVerificationResult,
  verifyQueueToken,
  leaveQueue,
  releaseAdmission,
};