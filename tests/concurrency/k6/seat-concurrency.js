import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';
import { Counter, Trend } from 'k6/metrics';

function integer(name, fallback) {
  const raw = __ENV[name] === undefined ? String(fallback) : __ENV[name];
  if (!/^[0-9]+$/.test(raw)) throw new Error(`${name}: integer required`);
  return Number(raw);
}
const base = (__ENV.BASE_URL || '').replace(/\/$/, '');
const eventId = __ENV.EVENT_ID;
const seatId = __ENV.SEAT_ID;
const runId = __ENV.RUN_ID;
const users = (__ENV.USER_IDS || '').split(',');
const delayMs = integer('START_DELAY_MS', 3000);
const maxWait = integer('QUEUE_MAX_WAIT_SECONDS', 60);
const pollSeconds = integer('QUEUE_POLL_SECONDS', 5);
const timeoutSeconds = integer('REQUEST_TIMEOUT_SECONDS', 10);
if (!base.startsWith('https://') || !runId ||
    !/^[1-9][0-9]*$/.test(eventId || '') || !/^[1-9][0-9]*$/.test(seatId || '') ||
    users.length !== 5 || new Set(users).size !== 5 ||
    users.some(id => !/^[1-9][0-9]*$/.test(id)) || delayMs < 1000 ||
    maxWait < 1 || maxWait > 60 || pollSeconds < 1 || timeoutSeconds < 1 || timeoutSeconds > 10) {
  throw new Error('HTTPS, RUN_ID, positive Event/Seat, five distinct users and bounded timings required');
}

const holdSuccesses = new Counter('hold_successes');
const holdConflicts = new Counter('hold_conflicts');
const bookingSuccesses = new Counter('booking_successes');
const networkFailures = new Counter('network_failures');
const unexpectedStatuses = new Counter('unexpected_statuses');
const joinSuccesses = new Counter('queue_join_successes');
const admissions = new Counter('queue_admissions');
const automationBookings = new Counter('automation_bookings');
const startMs = new Trend('automation_scenario_start_ms');
const startLateness = new Trend('race_start_lateness_ms');

export const options = {
  insecureSkipTLSVerify: false,
  maxRedirects: 0,
  setupTimeout: '6m',
  scenarios: { same_seat: { executor: 'per-vu-iterations', vus: 5, iterations: 1, maxDuration: '1m' } },
  thresholds: {
    hold_successes: ['count==1'], hold_conflicts: ['count==4'],
    booking_successes: ['count==1'], network_failures: ['count==0'],
    unexpected_statuses: ['count==0'], checks: ['rate==1'],
  },
};

function body(response) {
  try { return response.json(); } catch (_) { return null; }
}

function post(path, payload, api, phase, expected, key, timeoutMs = timeoutSeconds * 1000) {
  return http.post(base + path, JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Idempotency-Key': key },
    timeout: `${timeoutMs}ms`, responseCallback: http.expectedStatuses(...expected),
    tags: { test: 'seat_concurrency', api, phase, run_id: runId },
  });
}

function validate(response, expected) {
  networkFailures.add(response.status === 0 ? 1 : 0);
  unexpectedStatuses.add(expected.includes(response.status) ? 0 : 1);
  return check(response, {
    'network connection succeeded': r => r.status !== 0,
    'status is expected': r => expected.includes(r.status),
  });
}

// Structured lines contain identifiers/timing only; admission tokens are never logged.
function evidence(kind, value) {
  console.log('EVIDENCE ' + JSON.stringify({ kind, run_id: runId, ...value }));
}

export function setup() {
  holdSuccesses.add(0); holdConflicts.add(0); bookingSuccesses.add(0);
  networkFailures.add(0); unexpectedStatuses.add(0);
  const entries = [];
  for (let i = 0; i < users.length; i++) {
    const userId = users[i];
    const joined = post('/queue/join', { event_id: eventId, user_id: userId },
      'queue_join', 'setup', [202], `${runId}-join-${userId}`);
    const joinBody = body(joined);
    if (!validate(joined, [202]) || !joinBody || !joinBody.token) throw new Error(`Join failed: user ${userId}`);
    joinSuccesses.add(1);
    const deadline = Date.now() + maxWait * 1000;
    let admitted = false;
    while (Date.now() < deadline) {
      const verified = post('/auth/verify', { event_id: eventId, token: joinBody.token },
        'auth_verify', 'setup', [200, 202], `${runId}-verify-${userId}`,
        Math.max(1, Math.min(timeoutSeconds * 1000, deadline - Date.now())));
      const value = body(verified);
      if (!validate(verified, [200, 202]) || Date.now() > deadline) break;
      if (verified.status === 200 && value && value.status === 'admitted') {
        admitted = true; admissions.add(1); break;
      }
      if (verified.status !== 202 || !value || !['waiting', 'queued'].includes(value.status)) break;
      sleep(Math.max(0, Math.min(pollSeconds, (deadline - Date.now()) / 1000)));
    }
    if (!admitted) throw new Error(`Admission failed or timed out: user ${userId}`);
    entries.push({ userId, token: joinBody.token });
  }
  // Recheck all earlier admissions before setting the target time (no new queue entries).
  for (const entry of entries) {
    const response = post('/auth/verify', { event_id: eventId, token: entry.token },
      'auth_verify', 'pre_race', [200], `${runId}-ready-${entry.userId}`);
    if (!validate(response, [200]) || body(response)?.status !== 'admitted') {
      throw new Error(`Admission no longer valid: user ${entry.userId}`);
    }
  }
  const targetMs = Date.now() + delayMs;
  evidence('ready', { target_ms: targetMs, event_id: eventId, seat_id: seatId, user_ids: users });
  return { targetMs };
}

export default function (data) {
  const userId = users[exec.vu.idInTest - 1];
  while (Date.now() < data.targetMs) sleep(Math.max(0, (data.targetMs - Date.now()) / 1000));
  // This interval includes client connection/TLS overhead. It is NOT a server lock interval.
  const begin = Date.now();
  const response = post(`/seats/${seatId}/hold`, { event_id: eventId, user_id: userId },
    'seat_hold', 'race', [200, 409], `${runId}-hold-${userId}`);
  const end = Date.now();
  evidence('hold', { user_id: userId, seat_id: seatId, target_ms: data.targetMs,
    start_ms: begin, end_ms: end, lateness_ms: begin - data.targetMs,
    status: response.status, duration_ms: response.timings.duration });
  startMs.add(begin); startLateness.add(begin - data.targetMs);
  validate(response, [200, 409]);
  if (response.status === 409) holdConflicts.add(1);
  if (response.status !== 200) return;
  holdSuccesses.add(1);
  const bookingBegin = Date.now();
  const booking = post('/bookings', { event_id: eventId, seat_id: seatId, user_id: userId },
    'booking', 'winner', [201], `${runId}-booking-${userId}`);
  const bookingEnd = Date.now();
  const bookingId = String(body(booking)?.booking_id || '');
  evidence('booking', { user_id: userId, seat_id: seatId, booking_id: bookingId,
    start_ms: bookingBegin, end_ms: bookingEnd, status: booking.status });
  validate(booking, [201]);
  if (booking.status === 201) {
    bookingSuccesses.add(1);
    check(bookingId, { 'booking ID is positive integer': id => /^[1-9][0-9]*$/.test(id) });
    if (/^[1-9][0-9]*$/.test(bookingId)) automationBookings.add(1, {
      booking_id: bookingId, user_id: userId, seat_id: seatId, event_id: eventId,
    });
  }
}

export function handleSummary(data) {
  return { 'summary.json': JSON.stringify(data, null, 2),
    stdout: 'k6 finished. Raw summary: summary.json; per-request evidence: events.log\n' };
}
