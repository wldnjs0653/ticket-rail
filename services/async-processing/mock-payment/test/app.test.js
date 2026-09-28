import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';

let baseUrl;
let server;

before(async () => {
  const app = createApp({
    idFactory: () => 'payment-test-001',
    now: () => new Date('2026-09-02T10:00:03Z'),
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
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, { status: 'READY' });
});

test('valid payment request returns a successful mock payment', async () => {
  const response = await fetch(`${baseUrl}/payments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      booking_id: 1001,
      user_id: 10,
      amount: 50000,
      currency: 'KRW',
    }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    payment_id: 'payment-test-001',
    booking_id: 1001,
    user_id: 10,
    amount: 50000,
    currency: 'KRW',
    status: 'SUCCEEDED',
    processed_at: '2026-09-02T10:00:03.000Z',
  });
});

test('invalid payment request returns validation details', async () => {
  const response = await fetch(`${baseUrl}/payments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ booking_id: 1001, amount: 0 }),
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.code, 'INVALID_PAYMENT_REQUEST');
  assert.ok(body.errors.includes('user_id is required'));
  assert.ok(body.errors.includes('amount must be a positive integer'));
});

test('the same idempotency key returns the same payment id', async () => {
  const request = () => fetch(`${baseUrl}/payments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'booking-event-42' },
    body: JSON.stringify({ booking_id: 42, user_id: 10, amount: 50000 }),
  });
  const first = await (await request()).json();
  const second = await (await request()).json();
  assert.equal(first.payment_id, second.payment_id);
});
