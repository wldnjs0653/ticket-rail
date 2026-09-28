import { randomUUID } from 'node:crypto';

function requireValue(value, field) {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new Error(`${field} is required`);
  }
}

export function parseBookingCreated(value) {
  const event = JSON.parse(Buffer.isBuffer(value) ? value.toString('utf8') : value);
  requireValue(event.event_id, 'event_id');
  requireValue(event.aggregate_id, 'aggregate_id');
  if (event.event_type !== 'booking.created') {
    throw new Error(`unsupported event_type: ${event.event_type}`);
  }
  const payload = event.payload ?? {};
  requireValue(payload.booking_id, 'payload.booking_id');
  requireValue(payload.user_id, 'payload.user_id');
  if (!Number.isInteger(payload.amount) || payload.amount <= 0) {
    throw new Error('payload.amount must be a positive integer');
  }
  return event;
}

export function createPaymentHandler({
  paymentClient,
  publishPaymentCompleted,
  idFactory = randomUUID,
  now = () => new Date(),
  logger = console,
}) {
  return async (messageValue) => {
    const bookingEvent = parseBookingCreated(messageValue);
    const booking = bookingEvent.payload;
    const payment = await paymentClient({ eventId: bookingEvent.event_id, booking });
    const paymentEvent = {
      event_id: idFactory(),
      event_type: 'payment.completed',
      aggregate_id: bookingEvent.aggregate_id,
      occurred_at: now().toISOString(),
      version: 1,
      causation_id: bookingEvent.event_id,
      payload: {
        booking_id: booking.booking_id,
        user_id: booking.user_id,
        payment_id: payment.payment_id,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
      },
    };
    await publishPaymentCompleted(paymentEvent);
    logger.log(JSON.stringify({
      event: 'payment.completed.published',
      booking_id: booking.booking_id,
      source_event_id: bookingEvent.event_id,
      payment_event_id: paymentEvent.event_id,
    }));
    return paymentEvent;
  };
}
