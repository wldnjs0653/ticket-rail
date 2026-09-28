// Read-only traffic after admission. No booking, hold, release, Redis writes,
// or Verify renewal. The server alone owns admission expiry and capacity.
import { sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { sendApiRequest } from './api.js';
import { classifyResponse } from './checks.js';
import { optionalEnv } from '../config/environments.js';

export const readSessions = new Counter('queue_read_sessions');
export const readSessionsCompleted = new Counter('queue_read_sessions_completed');
export const readRequests = new Counter('queue_read_requests');
export const readFailures = new Counter('queue_read_failures');
export const readDuration = new Trend('queue_read_http_duration_ms', true);

function positive(name, fallback) {
  const value = Number(optionalEnv(name, String(fallback)));
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name}: positive finite seconds required`);
  return value;
}

export function buildReadConfig() {
  const mode = optionalEnv('QUEUE_READ_AFTER_ADMISSION', 'false');
  if (!['true', 'false'].includes(mode)) throw new Error('QUEUE_READ_AFTER_ADMISSION: true or false required');
  return {
    enabled: mode === 'true',
    ttlSeconds: positive('QUEUE_ADMISSION_TTL_SECONDS', 600),
    thinkSeconds: positive('QUEUE_READ_INTERVAL_SECONDS', 1),
    timeoutSeconds: positive('QUEUE_READ_TIMEOUT_SECONDS', 15),
  };
}

export function readWhileAdmitted({ baseUrl, eventId, admission, commonHeaders, config, tags }) {
  if (!config.enabled || !admission || admission.admitted !== true) return;
  // Each run uses fresh identities and stops polling on first success. Admission
  // is created during that Verify request. Its client-side start is a conservative
  // lower bound on server admission time; response time must NOT extend the TTL.
  // This does not prove server-side authorization or server capacity compliance.
  if (!Number.isFinite(admission.requestStartedAtMs)) throw new Error('Missing successful Verify request start');
  const deadline = admission.requestStartedAtMs + config.ttlSeconds * 1000;
  const requestTags = { ...tags, api: 'admitted_seat_read', phase: 'admitted_read' };
  readSessions.add(1, tags);
  readFailures.add(0, tags);
  while (Date.now() < deadline) {
    const remaining = Math.floor(deadline - Date.now());
    if (remaining < 1) break;
    // Do not manufacture a timeout by starting a request with only a few ms
    // left in the lease. Remain idle until the conservative client deadline.
    if (remaining < config.timeoutSeconds * 1000) {
      sleep(remaining / 1000);
      break;
    }
    const response = sendApiRequest({ baseUrl, path: `/seats/${eventId}`,
      headers: commonHeaders, tags: requestTags,
      timeout: `${Math.min(config.timeoutSeconds * 1000, remaining)}ms` });
    readRequests.add(1, tags);
    readDuration.add(response.timings.duration, tags);
    classifyResponse(response, [200]);
    // Includes unexpected 2xx responses, which common classification permits.
    if (response.status !== 200) readFailures.add(1, tags);
    // Authorization rejection ends the session; do not reacquire or renew.
    if ([401, 403, 410].includes(response.status)) break;
    const rest = Math.max(0, (deadline - Date.now()) / 1000);
    if (rest > 0) sleep(Math.min(config.thinkSeconds, rest));
  }
  readSessionsCompleted.add(1, tags);
}
