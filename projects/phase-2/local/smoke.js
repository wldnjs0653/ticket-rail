// Run inside the local demo container: node local/smoke.js
// Uses real PostgreSQL, Redis and Kafka; payment/notification are mocks.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const base = 'http://127.0.0.1:3000';
const runId = randomUUID();

async function request(path, { body, key, statuses = [200] } = {}) {
  const response = await fetch(`${base}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(key ? { 'Idempotency-Key': `${runId}-${key}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  const data = await response.json();
  assert.ok(statuses.includes(response.status), `${path}: HTTP ${response.status} ${JSON.stringify(data)}`);
  return data;
}

async function main() {
  await request('/health/ready');
  const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
  const catalog = await request(`/events?date=${date}`);
  assert.ok(catalog.events.length > 0, 'dated train catalog must be initialized');
  const repeated = await request(`/events?date=${date}`);
  assert.equal(repeated.events.length, catalog.events.length);
  const train = catalog.events.find(event => Number(event.available_seats) > 0);
  assert.ok(train, 'local catalog needs an available seat');
  const eventId = train.id;
  const { seats } = await request(`/seats/${eventId}`);
  const seat = seats.find(candidate => candidate.status === 'AVAILABLE');
  assert.ok(seat && Number(seat.price) > 0 && seat.grade, 'seat price/grade must exist');

  const joined = await request('/queue/join', {
    body: { event_id: eventId, user_id: 1 }, key: 'queue', statuses: [202],
  });
  const admitted = await request('/auth/verify', { body: { event_id: eventId, token: joined.token } });
  assert.equal(admitted.status, 'admitted');
  await request(`/seats/${seat.id}/hold`, {
    body: { event_id: eventId, user_id: 1 }, key: 'hold',
  });
  const bookingBody = { event_id: eventId, seat_id: seat.id, user_id: 1 };
  const booking = await request('/bookings', {
    body: bookingBody, key: 'booking', statuses: [201],
  });
  const duplicate = await request('/bookings', {
    body: bookingBody, key: 'booking', statuses: [200, 201],
  });
  assert.equal(duplicate.booking_id, booking.booking_id, 'retry must return the same booking');
  const stored = await request(`/bookings/${booking.booking_id}`);
  assert.equal(stored.seats.length, 1);

  // Readiness alone cannot prove that the Kafka Consumer chain has completed.
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const payment = await request(`/payments/${booking.booking_id}`, { statuses: [200, 404] });
    if (payment.status === 'APPROVED' && payment.notification_sent === true) {
      assert.equal(Number(payment.amount), Number(seat.price));
      console.log(`PASS: catalog, queue, admission, hold, booking, idempotency, Kafka payment and notification (booking ${booking.booking_id})`);
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Kafka payment/notification did not complete within 90 seconds');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
