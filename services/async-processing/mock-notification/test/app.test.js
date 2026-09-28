import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';

let server;
let baseUrl;

before(async () => {
  const app = createApp({
    idFactory: () => 'notification-test-id',
    now: () => new Date('2026-09-02T00:00:00.000Z'),
  });

  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test('readiness endpoint returns READY', async () => {
  const response = await fetch(`${baseUrl}/health/ready`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'READY' });
});

test('valid notification request returns SENT', async () => {
  const response = await fetch(`${baseUrl}/notifications`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      booking_id: 1001,
      user_id: 10,
      channel: 'email',
      message: 'Your booking and payment are complete.',
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    notification_id: 'notification-test-id',
    booking_id: 1001,
    user_id: 10,
    channel: 'EMAIL',
    status: 'SENT',
    sent_at: '2026-09-02T00:00:00.000Z',
  });
});

test('invalid notification request returns validation details', async () => {
  const response = await fetch(`${baseUrl}/notifications`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ channel: 'PUSH', message: '' }),
  });

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.code, 'INVALID_NOTIFICATION_REQUEST');
  assert.equal(body.errors.length, 4);
});

test('the same idempotency key returns the same notification id', async () => {
  const request = () => fetch(`${baseUrl}/notifications`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'payment-event-42' },
    body: JSON.stringify({
      booking_id: 42,
      user_id: 10,
      channel: 'EMAIL',
      message: 'Payment complete.',
    }),
  });
  const first = await (await request()).json();
  const second = await (await request()).json();
  assert.equal(first.notification_id, second.notification_id);
});
