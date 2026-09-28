import { sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { classifyResponse } from './checks.js';
import { sendApiRequest } from './api.js';
import {
  csvStatusCodes,
  csvValues,
  optionalEnv, durationEnv, durationToSeconds, numberEnv,
} from '../config/environments.js';

export const queueJoinSuccesses = new Counter('queue_join_successes');
export const queueJoinFailures = new Counter('queue_join_failures');
export const queuePollAttempts = new Counter('queue_poll_attempts');
export const queueWaitingResponses = new Counter('queue_waiting_responses');
export const queueAdmissions = new Counter('queue_admissions');
export const queueAdmissionFailures = new Counter('queue_admission_failures');
export const queueWaitDuration = new Trend('queue_wait_duration_ms', true);

function responseStatus(response) {
  try {
    return String(response.json('status') || '').toLowerCase();
  } catch (_) {
    return '';
  }
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
    pollIntervalSeconds: numberEnv('QUEUE_POLL_INTERVAL_SECONDS', 1),
    maxWaitSeconds: numberEnv('QUEUE_MAX_WAIT_SECONDS', 600),
    requestTimeout: durationEnv('REQUEST_TIMEOUT', '2s'),
  };
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
    timeout: config.requestTimeout,
    successCodes: config.joinCodes,
  });
  classifyResponse(response, config.joinCodes, [], { ...tags, api: 'queue_join' });

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

  if (typeof token !== 'string' || !token.trim()) {
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
    queuePollAttempts.add(1, tags);
    const response = sendApiRequest({
      baseUrl,
      path: config.verifyPath,
      method: 'POST',
      headers: commonHeaders,
      body: { event_id: eventId, token },
      tags: { ...tags, api: 'auth_verify' },
      timeout: `${Math.max(1, Math.ceil(Math.min(deadline - Date.now(),
        durationToSeconds(config.requestTimeout) * 1000)))}ms`,
      successCodes: [...config.admittedCodes, ...config.waitingCodes],
    });

    const bodyStatus = responseStatus(response);
    const admitted = config.admittedCodes.includes(response.status)
      && config.admittedStatuses.includes(bodyStatus);

    if (admitted) {
      classifyResponse(response, config.admittedCodes, [], { ...tags, api: 'auth_verify' });
      const waitMs = Date.now() - startedAt;
      queueAdmissions.add(1, tags);
      queueWaitDuration.add(waitMs, tags);
      return { admitted: true, response, waitMs };
    }

    const waiting = config.waitingCodes.includes(response.status)
      && config.waitingStatuses.includes(bodyStatus);
    if (waiting) {
      classifyResponse(response, config.waitingCodes, [], { ...tags, api: 'auth_verify' });
      queueWaitingResponses.add(1, tags);
      const remaining = (deadline - Date.now()) / 1000;
      if (remaining > 0) sleep(Math.min(config.pollIntervalSeconds, remaining));
      continue;
    }

    classifyResponse(response, [...config.admittedCodes, ...config.waitingCodes], [],
      { ...tags, api: 'auth_verify' });
    queueAdmissionFailures.add(1, tags);
    return { admitted: false, response,
      reason: config.expiredCodes.includes(response.status) ? 'expired' : 'rejected_or_invalid_body' };
  }

  queueAdmissionFailures.add(1, tags);
  return { admitted: false, response: null, reason: 'timeout' };
}
