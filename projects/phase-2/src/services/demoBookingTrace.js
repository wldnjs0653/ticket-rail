const { randomUUID } = require('node:crypto');

const enabled = process.env.ENABLE_LOCAL_BOOKING_TRACE === 'true';
const lifetimeMs = 60 * 60 * 1000;
const holds = new Map();
const traces = new Map();

function store(map, key, value, limit) {
  map.delete(key);
  map.set(key, value);
  if (map.size > limit) map.delete(map.keys().next().value);
}

function rememberHold(key, userId, ttlSeconds) {
  if (!enabled) return;
  const now = Date.now();
  store(holds, key, {
    owner: String(userId),
    expiresAt: now + ttlSeconds * 1000,
    at: new Date(now).toISOString(),
    ttlSeconds,
  }, 500);
}

function findHold(key, userId) {
  const hold = holds.get(key);
  if (hold?.owner === String(userId) && hold.expiresAt > Date.now()) return hold;
}

function findBooking(bookingId) {
  const key = String(bookingId);
  const trace = traces.get(key);
  if (!trace) return;
  if (trace.expiresAt > Date.now()) return trace;
  traces.delete(key);
}

function record(bookingId, stage, details = {}) {
  const trace = findBooking(bookingId);
  if (trace) trace.stages[stage] ??= { at: new Date().toISOString(), ...details };
}

function start(bookingId, seat, hold, seatLabel) {
  if (!enabled) return;
  const trace = {
    token: randomUUID(),
    bookingId,
    seat,
    // This is display metadata only. The booking and hold still use the persisted seat ID.
    seatLabel: typeof seatLabel === 'string' && /^[1-5]호차 (?:[1-9]|10)[A-D]$/.test(seatLabel) ? seatLabel : undefined,
    expiresAt: Date.now() + lifetimeMs,
    stages: {},
  };
  if (hold) trace.stages.seatHeld = { at: hold.at, ttlSeconds: hold.ttlSeconds };
  store(traces, String(bookingId), trace, 200);
  record(bookingId, 'bookingStored');
  return trace.token;
}

function read(token) {
  if (!enabled || typeof token !== 'string' || !/^[0-9a-f-]{36}$/.test(token)) return;
  for (const [bookingId, trace] of traces) {
    if (trace.token === token && findBooking(bookingId)) {
      return { bookingId: trace.bookingId, seat: trace.seat, seatLabel: trace.seatLabel, stages: trace.stages };
    }
  }
}

function tokenFor(bookingId) {
  return findBooking(bookingId)?.token;
}

module.exports = { enabled, rememberHold, findHold, start, record, read, tokenFor };
