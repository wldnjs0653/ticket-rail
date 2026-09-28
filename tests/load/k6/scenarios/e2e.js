export { handleSummary } from '../common/results.js';
import { recordBooking } from '../common/automation.js';
import { Counter } from 'k6/metrics';
import { configureExpectedStatuses, sendApiRequest } from '../common/api.js';
import { classifyResponse } from '../common/checks.js';
import { buildQueueConfig, joinQueue, waitForAdmission } from '../common/queue.js';
import {
  optionalEnv,
  parseOptionalJsonEnv,
  requiredEnv,
} from '../config/environments.js';

const baseUrl = requiredEnv('BASE_URL');
const eventId = requiredEnv('EVENT_ID');
const seatId = requiredEnv('SEAT_ID');
const userId = requiredEnv('USER_ID');
const runId = optionalEnv('RUN_ID', `${Date.now()}`);
const holdPathTemplate = optionalEnv('HOLD_PATH_TEMPLATE', '/seats/{seatId}/hold');
const bookingPath = optionalEnv('BOOKING_PATH', '/bookings');
const commonHeaders = parseOptionalJsonEnv('REQUEST_HEADERS_JSON', {});
const queueConfig = buildQueueConfig();

const holdSuccesses = new Counter('e2e_hold_successes');
const bookingSuccesses = new Counter('e2e_booking_successes');

configureExpectedStatuses([200, 201, 202], [409]);

export const options = {
  scenarios: {
    single_e2e: { executor: 'shared-iterations', vus: 1, iterations: 1, maxDuration: '15m' },
  },
  thresholds: {
    e2e_hold_successes: ['count==1'],
    e2e_booking_successes: ['count==1'],
    network_failures: ['count==0'],
    unexpected_statuses: ['count==0'],
  },
};

function idem(step) {
  return `k6-e2e-${runId}-${step}`;
}

function requireResult(result, step) {
  if (!result) throw new Error(`${step} 실패`);
  return result;
}

export default function () {
  const tags = { test: 'e2e' };
  const joined = requireResult(joinQueue({
    baseUrl,
    eventId,
    userId,
    idempotencyKey: idem('queue'),
    commonHeaders,
    config: queueConfig,
    tags,
  }), '대기열 참가');

  const admission = waitForAdmission({
    baseUrl,
    eventId,
    token: joined.token,
    commonHeaders,
    config: queueConfig,
    tags,
  });
  if (!admission.admitted) throw new Error(`입장 확인 실패: ${admission.reason}`);

  const holdResponse = sendApiRequest({
    baseUrl,
    path: holdPathTemplate.replace('{seatId}', seatId),
    method: 'POST',
    headers: { ...commonHeaders, 'Idempotency-Key': idem('hold') },
    body: { event_id: eventId, user_id: userId },
    tags: { ...tags, api: 'seat_hold' },
  });
  classifyResponse(holdResponse, [200], [409]);
  if (holdResponse.status !== 200) {
    throw new Error(`좌석 Hold 실패: status=${holdResponse.status}`);
  }
  holdSuccesses.add(1, tags);

  const bookingResponse = sendApiRequest({
    baseUrl,
    path: bookingPath,
    method: 'POST',
    headers: { ...commonHeaders, 'Idempotency-Key': idem('booking') },
    body: { event_id: eventId, seat_id: seatId, user_id: userId },
    tags: { ...tags, api: 'booking' },
  });
  classifyResponse(bookingResponse, [201], [409]);
  if (bookingResponse.status !== 201) {
    throw new Error(`예약 실패: status=${bookingResponse.status}`);
  }
  bookingSuccesses.add(1, tags);
  recordBooking(bookingResponse.json('booking_id'), eventId, seatId, userId);

  console.log(JSON.stringify({
    run_id: runId,
    user_id: userId,
    event_id: eventId,
    seat_id: seatId,
    booking_id: bookingResponse.json('booking_id'),
  }));
}
