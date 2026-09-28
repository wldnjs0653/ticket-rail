import exec from 'k6/execution';
import { SharedArray } from 'k6/data';
import { Counter } from 'k6/metrics';
import { runBooking } from '../common/booking.js';
import { buildQueueConfig } from '../common/queue.js';
import { arrivalScenario } from '../common/arrival.js';
import { databaseId, durationEnv, durationToSeconds, integerEnv, optionalEnv,
  parseOptionalJsonEnv, requiredEnv } from '../config/environments.js';

const baseUrl = requiredEnv('BASE_URL');
const casesFile = optionalEnv('BOOKING_CASES_FILE', '../data/booking-cases.json');
const cases = new SharedArray('booking cases', () => {
  const parsed = JSON.parse(open(casesFile));
  if (!Array.isArray(parsed) || !parsed.length) throw new Error('예약 데이터 배열이 비어 있습니다.');
  const seats = new Set();
  const users = new Set();
  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new Error('예약 데이터 객체가 필요합니다: ' + index);
    const c = {};
    for (const field of ['user_id', 'event_id', 'seat_id']) {
      c[field] = databaseId(entry[field], '예약 데이터 ' + index + '.' + field);
    }
    const seatKey = c.event_id + ':' + c.seat_id;
    const userKey = c.event_id + ':' + c.user_id;
    if (seats.has(seatKey)) throw new Error('같은 좌석을 재사용할 수 없습니다: ' + seatKey);
    if (users.has(userKey)) throw new Error('행사별로 다른 사용자 ID가 필요합니다: ' + userKey);
    seats.add(seatKey);
    users.add(userKey);
    return c;
  });
});
const runId = optionalEnv('RUN_ID', String(Date.now()));
const rate = integerEnv('BOOKING_RATE', 1);
const duration = durationEnv('BOOKING_DURATION', '3s');
const queueConfig = buildQueueConfig();
const requiredCases = Math.ceil(rate * durationToSeconds(duration));
if (cases.length < requiredCases) {
  throw new Error('예약 데이터가 최소 ' + requiredCases + '개 필요합니다. 현재 ' + cases.length
    + '개입니다. BOOKING_RATE는 예약 흐름 시작 횟수/초입니다.');
}
const commonHeaders = parseOptionalJsonEnv('REQUEST_HEADERS_JSON', {});
const holdPathTemplate = optionalEnv('HOLD_PATH_TEMPLATE', '/seats/{seatId}/hold');
const bookingPath = optionalEnv('BOOKING_PATH', '/bookings');
const bookingSuccesses = new Counter('stream_booking_successes');
const bookingConflicts = new Counter('stream_booking_conflicts');
const budget = 3 * durationToSeconds(queueConfig.requestTimeout) + queueConfig.maxWaitSeconds;

export const options = {
  scenarios: { booking_stream: arrivalScenario(rate, duration, budget) },
  thresholds: { dropped_iterations: ['count==0'] },
  tags: { test: 'booking_stream', run_id: runId },
};

export default function () {
  const index = exec.scenario.iterationInTest;
  const testCase = cases[index];
  if (!testCase) throw new Error('예약 데이터 부족: iteration=' + index + '. 데이터 재사용은 금지합니다.');
  const tags = { test: 'booking_stream' };
  const result = runBooking({ baseUrl, testCase, keyPrefix: 'k6-stream-' + runId + '-' + index,
    commonHeaders, queueConfig, holdPathTemplate, bookingPath, tags });
  bookingSuccesses.add(result.success ? 1 : 0, tags);
  bookingConflicts.add(result.conflict ? 1 : 0, tags);
}
