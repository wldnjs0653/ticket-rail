import assert from 'node:assert/strict';
import test from 'node:test';
import { createPaymentHandler, parseBookingCreated } from '../src/handler.js';

const bookingEvent = {
  event_id: 'booking-event-1', event_type: 'booking.created', aggregate_id: 'booking-1001',
  occurred_at: '2026-09-02T10:00:00Z', version: 1,
  payload: { booking_id: 1001, user_id: 10, amount: 50000, currency: 'KRW' },
};

test('parseBookingCreated rejects an unsupported event', () => {
  assert.throws(
    () => parseBookingCreated(JSON.stringify({ ...bookingEvent, event_type: 'unknown' })),
    /unsupported event_type/,
  );
});

test('handler calls payment and publishes payment.completed', async () => {
  const published = [];
  const handler = createPaymentHandler({
    paymentClient: async ({ eventId, booking }) => {
      assert.equal(eventId, 'booking-event-1');
      assert.equal(booking.booking_id, 1001);
      return { payment_id: 'payment-2001', amount: 50000, currency: 'KRW', status: 'SUCCEEDED' };
    },
    publishPaymentCompleted: async (event) => published.push(event),
    idFactory: () => 'payment-event-1',
    now: () => new Date('2026-09-02T10:00:03Z'),
    logger: { log() {} },
  });
  const result = await handler(Buffer.from(JSON.stringify(bookingEvent)));
  assert.equal(result.event_type, 'payment.completed');
  assert.equal(result.causation_id, 'booking-event-1');
  assert.equal(result.payload.status, 'SUCCEEDED');
  assert.deepEqual(published, [result]);
});
