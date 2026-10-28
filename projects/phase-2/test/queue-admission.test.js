const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  JOIN_QUEUE_SCRIPT,
  VERIFY_QUEUE_SCRIPT,
  queueKeys,
  joinQueue,
  normalizeVerificationResult,
  verifyQueueToken,
} = require('../src/services/queueAdmission');

test('이벤트별 Redis 키를 동일한 prefix로 생성한다', () => {
  assert.deepEqual(queueKeys(79, 'token-1'), {
    sequence: 'queue:79:seq',
    token: 'queue:79:token:token-1',
    tokenPrefix: 'queue:79:token:',
    waiting: 'queue:79:waiting',
    admitted: 'queue:79:admitted:set',
    admissionPrefix: 'queue:79:admitted:',
    rejected: 'queue:79:reject_count',
  });
});

test('Lua 스크립트가 순번 발급과 원자적 입장을 포함한다', () => {
  assert.match(JOIN_QUEUE_SCRIPT, /INCR/);
  assert.match(JOIN_QUEUE_SCRIPT, /ZADD/);
  assert.match(VERIFY_QUEUE_SCRIPT, /ZRANK/);
  assert.match(VERIFY_QUEUE_SCRIPT, /availableSlots/);
  assert.match(VERIFY_QUEUE_SCRIPT, /ZREMRANGEBYSCORE/);
});

test('대기 상태 응답을 숫자 필드로 정규화한다', () => {
  assert.deepEqual(
    normalizeVerificationResult(['waiting', '200', '2625', '14', '1820', '3500000', '0']),
    {
      status: 'waiting',
      currentAdmitted: 200,
      originalPosition: 2625,
      waitingPosition: 14,
      totalWaiting: 1820,
      remainingMs: 3500000,
      newlyAdmitted: false,
    }
  );
});

test('최초 입장 여부를 구분한다', () => {
  const result = normalizeVerificationResult(
    ['admitted', '199', '14', '0', '120', '600000', '1']
  );
  assert.equal(result.status, 'admitted');
  assert.equal(result.newlyAdmitted, true);
  assert.equal(result.waitingPosition, 0);
});

test('토큰 payload의 사용자 ID로 실제 admission key를 계산한다', async () => {
  const calls = [];
  const redis = {
    get: async () => JSON.stringify({ user_id: 77, position: 9 }),
    eval: async (...args) => {
      calls.push(args);
      return ['waiting', '200', '9', '3', '20', '3000000', '0'];
    },
  };

  const result = await verifyQueueToken(redis, {
    eventId: 79,
    token: 'token-77',
    admissionLimit: 200,
    admissionTtlSeconds: 600,
  });

  assert.equal(result.userId, 77);
  assert.equal(result.waitingPosition, 3);
  assert.equal(calls[0][5], 'queue:79:admitted:77');
});

test('join은 Redis Lua 결과를 기존 position 응답으로 유지한다', async () => {
  const redis = {
    eval: async (...args) => {
      assert.equal(args[2], 'queue:79:seq');
      assert.equal(args[3], 'queue:79:token:token-1');
      assert.equal(args[4], 'queue:79:waiting');
      return 42;
    },
  };

  const position = await joinQueue(redis, {
    eventId: 79,
    userId: 1,
    token: 'token-1',
    issuedAt: '2026-10-01T00:00:00.000Z',
    tokenTtlSeconds: 3900,
  });

  assert.equal(position, 42);
});

test('티켓 화면에 대기실과 새로고침 복원 코드가 포함된다', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'public', 'ticketing.html'),
    'utf8'
  );

  assert.match(html, /id="queueWaitingModal"/);
  assert.match(html, /waiting_position/);
  assert.match(html, /sessionStorage\.setItem\(QUEUE_SESSION_KEY/);
  assert.match(html, /response\.status === 200/);
  assert.match(html, /resumeQueueWaiting\(\)/);
  assert.match(html, /현재 대기순번/);
  assert.doesNotMatch(html, /queueTotalWaiting/);
  assert.doesNotMatch(html, /queueCurrentAdmitted/);
  assert.doesNotMatch(html, /개발자 · 시연 도구/);
});