import assert from 'node:assert/strict';
import test from 'node:test';
import { createNotificationHandler, parsePaymentCompleted } from '../src/handler.js';

const paymentEvent = {
  event_id: 'payment-event-1', event_type: 'payment.completed', aggregate_id: 'booking-1001',
  occurred_at: '2026-09-02T10:00:03Z', version: 1,
  payload: {
    booking_id: 1001, user_id: 10, payment_id: 'payment-2001',
    amount: 50000, currency: 'KRW', status: 'SUCCEEDED',
  },
};

test('parsePaymentCompleted rejects an unsupported event', () => {
  assert.throws(
    () => parsePaymentCompleted(JSON.stringify({ ...paymentEvent, event_type: 'unknown' })),
    /unsupported event_type/,
  );
});

test('handler sends a notification for payment.completed', async () => {
  const requests = [];
  const handler = createNotificationHandler({
    notificationClient: async (request) => {
      requests.push(request);
      return { notification_id: 'notification-3001', status: 'SENT' };
    },
    logger: { log() {} },
  });
  const result = await handler(Buffer.from(JSON.stringify(paymentEvent)));
  assert.equal(result.status, 'SENT');
  assert.equal(requests[0].eventId, 'payment-event-1');
  assert.equal(requests[0].payment.booking_id, 1001);
  assert.match(requests[0].message, /payment completed/);
});
