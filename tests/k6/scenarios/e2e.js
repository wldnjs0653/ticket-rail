import { runBooking } from '../common/booking.js';
import { Counter } from 'k6/metrics';
import { buildQueueConfig } from '../common/queue.js';
import { databaseId, durationToSeconds, optionalEnv, parseOptionalJsonEnv,
  requiredEnv } from '../config/environments.js';

const baseUrl = requiredEnv('BASE_URL');
const testCase = {
  user_id: databaseId(requiredEnv('USER_ID'), 'USER_ID'),
  event_id: databaseId(requiredEnv('EVENT_ID'), 'EVENT_ID'),
  seat_id: databaseId(requiredEnv('SEAT_ID'), 'SEAT_ID'),
};
const runId = optionalEnv('RUN_ID', String(Date.now()));
const queueConfig = buildQueueConfig();
const holdPathTemplate = optionalEnv('HOLD_PATH_TEMPLATE', '/seats/{seatId}/hold');
const bookingPath = optionalEnv('BOOKING_PATH', '/bookings');
const commonHeaders = parseOptionalJsonEnv('REQUEST_HEADERS_JSON', {});
const holdSuccesses = new Counter('e2e_hold_successes');
const bookingSuccesses = new Counter('e2e_booking_successes');

export const options = {
  scenarios: { e2e: { executor: 'shared-iterations', vus: 1, iterations: 1,
    maxDuration: String(Math.ceil(queueConfig.maxWaitSeconds
      + 3 * durationToSeconds(queueConfig.requestTimeout)) + 10) + 's' } },
  thresholds: {
    e2e_hold_successes: ['count==1'], e2e_booking_successes: ['count==1'],
    flow_started: ['count==1'], flow_completed: ['count==1'], flow_successes: ['count==1'],
    flow_failed: ['rate==0'], network_failures: ['count==0'], unexpected_statuses: ['count==0'],
  },
  tags: { test: 'e2e', run_id: runId },
};

export default function () {
  const result = runBooking({ baseUrl, testCase, keyPrefix: 'k6-e2e-' + runId,
    commonHeaders, queueConfig, holdPathTemplate, bookingPath, tags: { test: 'e2e' } });
  holdSuccesses.add(result.step === 'booking' ? 1 : 0);
  bookingSuccesses.add(result.success ? 1 : 0);
  if (!result.success) throw new Error('예약 흐름 실패: step=' + result.step + ', conflict=' + result.conflict);
  console.log('예약 HTTP 201 확인. 결제·알림 완료 및 업무 중복 여부는 별도 결과 확인이 필요합니다.');
}
