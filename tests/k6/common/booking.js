import { beginFlow } from './flow.js';
import { sendApiRequest } from './api.js';
import { classifyResponse } from './checks.js';
import { joinQueue, waitForAdmission } from './queue.js';

export function runBooking({ baseUrl, testCase, keyPrefix, commonHeaders,
  queueConfig, holdPathTemplate, bookingPath, tags }) {
  const { user_id: userId, event_id: eventId, seat_id: seatId } = testCase;
  const finish = beginFlow(tags);
  let step = 'queue_join';
  let success = false;
  let conflict = false;
  try {
    const joined = joinQueue({ baseUrl, eventId, userId,
      idempotencyKey: keyPrefix + '-queue', commonHeaders, config: queueConfig, tags });
    if (!joined) return { success, step, conflict };

    step = 'auth_verify';
    const admission = waitForAdmission({ baseUrl, eventId, token: joined.token,
      commonHeaders, config: queueConfig, tags });
    if (!admission.admitted) return { success, step, conflict, reason: admission.reason };

    step = 'seat_hold';
    const hold = sendApiRequest({ baseUrl,
      path: holdPathTemplate.replace('{seatId}', encodeURIComponent(String(seatId))),
      method: 'POST', headers: { ...commonHeaders, 'Idempotency-Key': keyPrefix + '-hold' },
      body: { event_id: eventId, user_id: userId },
      tags: { ...tags, api: step }, timeout: queueConfig.requestTimeout,
      successCodes: [200], conflictCodes: [409] });
    const held = classifyResponse(hold, [200], [409], { ...tags, api: step });
    conflict = held.isBusinessConflict;
    if (!held.isSuccess) return { success, step, conflict };

    step = 'booking';
    const booked = sendApiRequest({ baseUrl, path: bookingPath, method: 'POST',
      headers: { ...commonHeaders, 'Idempotency-Key': keyPrefix + '-booking' },
      body: { event_id: eventId, seat_id: seatId, user_id: userId },
      tags: { ...tags, api: step }, timeout: queueConfig.requestTimeout,
      successCodes: [201], conflictCodes: [409] });
    const result = classifyResponse(booked, [201], [409], { ...tags, api: step });
    success = result.isSuccess;
    conflict = result.isBusinessConflict;
    return { success, step, conflict, response: booked };
  } finally {
    finish(success, step, conflict);
  }
}
