import exec from 'k6/execution';
import { Counter } from 'k6/metrics';
import { sendApiRequest } from '../common/api.js';
import { classifyResponse } from '../common/checks.js';
import {
  csvStatusCodes,
  integerEnv,
  optionalEnv,
  parseOptionalJsonEnv,
  requiredCsvValues,
  requiredEnv,
  databaseId, durationEnv,
} from '../config/environments.js';
import { buildQueueConfig, joinQueue, waitForAdmission } from '../common/queue.js';

const baseUrl = requiredEnv('BASE_URL');
const eventId = requiredEnv('EVENT_ID');
const seatId = requiredEnv('SEAT_ID');
const userIds = requiredCsvValues('USER_IDS').map((id) => databaseId(id, 'USER_IDS'));
const vus = integerEnv('SEAT_VUS', userIds.length);
const holdPathTemplate = optionalEnv('HOLD_PATH_TEMPLATE', '/seats/{seatId}/hold');
const bookingPath = optionalEnv('BOOKING_PATH', '/bookings');
const commonHeaders = parseOptionalJsonEnv('REQUEST_HEADERS_JSON', {});
const conflictCodes = csvStatusCodes('CONFLICT_STATUS_CODES', [409]);
const queueConfig = buildQueueConfig();
const setupTimeout = durationEnv('SETUP_TIMEOUT', '15m');

const holdSuccesses = new Counter('hold_successes');
const holdConflicts = new Counter('hold_conflicts');
const bookingSuccesses = new Counter('booking_successes');
const bookingConflicts = new Counter('booking_conflicts');

if (vus < 2) {
  throw new Error('SEAT_VUS는 동시성 검증을 위해 2 이상이어야 합니다.');
}
if (userIds.length < vus) {
  throw new Error(`USER_IDS는 SEAT_VUS(${vus})개 이상 필요합니다. 현재 ${userIds.length}개입니다.`);
}

if (new Set(userIds.slice(0, vus)).size !== vus) throw new Error('USER_IDS에 중복 사용자가 있습니다.');
databaseId(eventId, 'EVENT_ID');
databaseId(seatId, 'SEAT_ID');

function requestHeaders(idempotencyKey) {
  return {
    ...commonHeaders,
    'Idempotency-Key': idempotencyKey,
  };
}

export const options = {
  setupTimeout,
  tags: { test: 'seat_concurrency', run_id: optionalEnv('RUN_ID', `${Date.now()}`) },
  scenarios: {
    same_seat: {
      executor: 'per-vu-iterations',
      vus,
      iterations: 1,
      maxDuration: '1m',
    },
  },
  thresholds: {
    hold_successes: ['count==1'],
    hold_conflicts: [`count==${vus - 1}`],
    booking_successes: ['count==1'],
    network_failures: ['count==0'],
    unexpected_statuses: ['count==0'],
  },
};

// 실제 Hold API는 대기열 등록과 입장 확인을 통과한 사용자만 허용한다.
// setup에서 사용자별 입장 상태를 먼저 만들고, 본 테스트에서는 Hold 요청만 동시에 시작한다.
export function setup() {
  const runId = `${Date.now()}`;
  const users = [];

  for (let index = 0; index < vus; index += 1) {
    const userId = userIds[index];
    const joined = joinQueue({
      baseUrl,
      eventId,
      userId,
      idempotencyKey: `k6-queue-${runId}-${index + 1}`,
      commonHeaders,
      config: queueConfig,
      tags: { test: 'seat_concurrency', phase: 'setup' },
    });
    if (!joined) throw new Error(`대기열 등록 실패: user_id=${userId}`);

    const admission = waitForAdmission({
      baseUrl,
      eventId,
      token: joined.token,
      commonHeaders,
      config: queueConfig,
      tags: { test: 'seat_concurrency', phase: 'setup' },
    });
    if (!admission.admitted) throw new Error(`입장 확인 실패: user_id=${userId}`);
    users.push(userId);
  }

  return { runId, users };
}

export default function (data) {
  holdSuccesses.add(0);
  holdConflicts.add(0);
  bookingSuccesses.add(0);
  bookingConflicts.add(0);
  const index = exec.vu.idInTest - 1;
  const userId = data.users[index];
  const holdPath = holdPathTemplate.replace('{seatId}', seatId);

  const holdResponse = sendApiRequest({
    baseUrl,
    path: holdPath,
    method: 'POST',
    headers: requestHeaders(`k6-hold-${data.runId}-${index + 1}`),
    body: { event_id: eventId, user_id: userId },
    tags: { test: 'seat_concurrency', phase: 'race', api: 'seat_hold' },
    successCodes: [200], conflictCodes, timeout: queueConfig.requestTimeout,
  });
  const holdResult = classifyResponse(holdResponse, [200], conflictCodes, { api: 'seat_hold' });

  if (holdResponse.status === 200) holdSuccesses.add(1);
  if (holdResult.isBusinessConflict) holdConflicts.add(1);

  if (holdResponse.status !== 200) return;

  const bookingResponse = sendApiRequest({
    baseUrl,
    path: bookingPath,
    method: 'POST',
    headers: requestHeaders(`k6-booking-${data.runId}-${index + 1}`),
    body: { event_id: eventId, seat_id: seatId, user_id: userId },
    tags: { test: 'seat_concurrency', phase: 'winner', api: 'booking' },
    successCodes: [201], conflictCodes, timeout: queueConfig.requestTimeout,
  });
  const bookingResult = classifyResponse(bookingResponse, [201], conflictCodes, { api: 'booking' });

  if (bookingResponse.status === 201) bookingSuccesses.add(1);
  if (bookingResult.isBusinessConflict) bookingConflicts.add(1);
}
