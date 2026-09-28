import { sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { classifyResponse } from './checks.js';
import { sendApiRequest } from './api.js';
import {
  csvStatusCodes,
  csvValues,
  optionalEnv,
} from '../config/environments.js';

export const queueJoinSuccesses = new Counter('queue_join_successes');
export const queueJoinFailures = new Counter('queue_join_failures');
export const queuePollAttempts = new Counter('queue_poll_attempts');
export const queueWaitingResponses = new Counter('queue_waiting_responses');
export const queueAdmissions = new Counter('queue_admissions');
export const queueAdmissionFailures = new Counter('queue_admission_failures');
export const queueSoldOut = new Counter('queue_sold_out');
export const queueWaitDuration = new Trend('queue_wait_duration_ms', true);

function numberEnv(name, fallback) {
  const value = Number.parseFloat(optionalEnv(name, String(fallback)));
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name}은(는) 0보다 큰 숫자여야 합니다.`);
  }
  return value;
}

function responseStatus(response) {
  try {
    return String(response.json('status') || '').toLowerCase();
  } catch (_) {
    return '';
  }
}

function requestTimeoutMs() {
  const raw = optionalEnv('REQUEST_TIMEOUT', '30s');
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(raw);
  if (!match) throw new Error('REQUEST_TIMEOUT은 500ms, 30s, 1m 같은 양의 시간이어야 합니다.');
  const value = Number(match[1]) * { ms: 1, s: 1000, m: 60000, h: 3600000 }[match[2]];
  if (!(value > 0)) throw new Error('REQUEST_TIMEOUT은 0보다 커야 합니다.');
  return value;
}

export function buildQueueConfig() {
  return {
    joinPath: optionalEnv('QUEUE_JOIN_PATH', '/queue/join'),
    verifyPath: optionalEnv('AUTH_VERIFY_PATH', '/auth/verify'),
    joinCodes: csvStatusCodes('QUEUE_JOIN_STATUS_CODES', [202]),
    admittedCodes: csvStatusCodes('QUEUE_ADMITTED_STATUS_CODES', [200]),
    waitingCodes: csvStatusCodes('QUEUE_WAITING_STATUS_CODES', [202]),
    expiredCodes: csvStatusCodes('QUEUE_EXPIRED_STATUS_CODES', [401, 410]),
    admittedStatuses: csvValues('QUEUE_ADMITTED_BODY_STATUSES', ['admitted']),
    waitingStatuses: csvValues('QUEUE_WAITING_BODY_STATUSES', ['waiting', 'queued']),
    // Empty codes disable this contract until the backend response is confirmed.
    soldOutCodes: csvStatusCodes('QUEUE_SOLD_OUT_STATUS_CODES', []),
    soldOutStatuses: csvValues('QUEUE_SOLD_OUT_BODY_STATUSES', ['sold_out']),
    pollIntervalSeconds: numberEnv('QUEUE_POLL_INTERVAL_SECONDS', 5),
    maxWaitSeconds: numberEnv('QUEUE_MAX_WAIT_SECONDS', 600),
    requestTimeoutMs: requestTimeoutMs(),
  };
}

export function isSoldOut(response, config) {
  return (config.soldOutCodes || []).includes(response.status)
    && (config.soldOutStatuses || []).includes(responseStatus(response));
}

export function joinQueue({
  baseUrl,
  eventId,
  userId,
  idempotencyKey,
  commonHeaders = {},
  config,
  tags = {},
}) {
  const response = sendApiRequest({
    baseUrl,
    path: config.joinPath,
    method: 'POST',
    headers: { ...commonHeaders, 'Idempotency-Key': idempotencyKey },
    body: { event_id: eventId, user_id: userId },
    tags: { ...tags, api: 'queue_join' },
  });
  if (isSoldOut(response, config)) {
    classifyResponse(response, [], config.soldOutCodes);
    queueSoldOut.add(1, { ...tags, step: 'join' });
    return { terminal: 'sold_out' };
  }
  classifyResponse(response, config.joinCodes);

  if (!config.joinCodes.includes(response.status)) {
    queueJoinFailures.add(1, tags);
    return null;
  }

  let token;
  try {
    token = response.json('token');
  } catch (_) {
    token = null;
  }

  if (!token) {
    queueJoinFailures.add(1, tags);
    return null;
  }

  queueJoinSuccesses.add(1, tags);
  return {
    token,
    position: response.json('position'),
  };
}

export function waitForAdmission({
  baseUrl,
  eventId,
  token,
  commonHeaders = {},
  config,
  tags = {},
}) {
  const startedAt = Date.now();
  const deadline = startedAt + config.maxWaitSeconds * 1000;

  while (Date.now() < deadline) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    queuePollAttempts.add(1, tags);
    const requestStartedAtMs = Date.now();
    const response = sendApiRequest({
      baseUrl,
      path: config.verifyPath,
      method: 'POST',
      headers: commonHeaders,
      body: { event_id: eventId, token },
      tags: { ...tags, api: 'auth_verify' },
      timeout: `${Math.min(config.requestTimeoutMs, remainingMs)}ms`,
    });

    const bodyStatus = responseStatus(response);
    // A late success cannot satisfy the maximum observed wait requirement.
    if (Date.now() > deadline) {
      classifyResponse(response, config.admittedCodes, config.expiredCodes);
      break;
    }
    if (isSoldOut(response, config)) {
      classifyResponse(response, [], config.soldOutCodes);
      queueSoldOut.add(1, { ...tags, step: 'verify' });
      return { admitted: false, response, reason: 'sold_out' };
    }
    if (config.expiredCodes.includes(response.status)) {
      classifyResponse(response, config.admittedCodes, config.expiredCodes);
      queueAdmissionFailures.add(1, { ...tags, reason: 'expired' });
      return { admitted: false, response, reason: 'expired' };
    }
    const admitted = config.admittedCodes.includes(response.status)
      && config.admittedStatuses.includes(bodyStatus);

    if (admitted) {
      classifyResponse(response, config.admittedCodes);
      const waitMs = Date.now() - startedAt;
      queueAdmissions.add(1, tags);
      queueWaitDuration.add(waitMs, tags);
      return { admitted: true, response, waitMs, requestStartedAtMs };
    }

    const waiting = config.waitingCodes.includes(response.status)
      && config.waitingStatuses.includes(bodyStatus);
    if (waiting) {
      classifyResponse(response, config.waitingCodes);
      queueWaitingResponses.add(1, tags);
      const remainingSeconds = Math.max(0, (deadline - Date.now()) / 1000);
      if (remainingSeconds > 0) sleep(Math.min(config.pollIntervalSeconds, remainingSeconds));
      continue;
    }

    classifyResponse(response, config.admittedCodes, config.expiredCodes);
    const reason = response.status === 0 ? 'network' :
      (response.status >= 200 && response.status < 300 ? 'protocol' : 'rejected');
    queueAdmissionFailures.add(1, { ...tags, reason });
    return { admitted: false, response, reason };
  }

  queueAdmissionFailures.add(1, { ...tags, reason: 'timeout' });
  return { admitted: false, response: null, reason: 'timeout' };
}
