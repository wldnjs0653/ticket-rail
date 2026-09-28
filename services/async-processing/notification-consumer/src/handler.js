function requireValue(value, field) {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new Error(`${field} is required`);
  }
}

export function parsePaymentCompleted(value) {
  const event = JSON.parse(Buffer.isBuffer(value) ? value.toString('utf8') : value);
  requireValue(event.event_id, 'event_id');
  requireValue(event.aggregate_id, 'aggregate_id');
  if (event.event_type !== 'payment.completed') {
    throw new Error(`unsupported event_type: ${event.event_type}`);
  }
  const payload = event.payload ?? {};
  requireValue(payload.booking_id, 'payload.booking_id');
  requireValue(payload.user_id, 'payload.user_id');
  requireValue(payload.payment_id, 'payload.payment_id');
  requireValue(payload.status, 'payload.status');
  return event;
}

export function createNotificationHandler({ notificationClient, logger = console }) {
  return async (messageValue) => {
    const paymentEvent = parsePaymentCompleted(messageValue);
    const payment = paymentEvent.payload;
    const message = payment.status === 'SUCCEEDED'
      ? `Booking ${payment.booking_id} payment completed.`
      : `Booking ${payment.booking_id} payment status: ${payment.status}.`;
    const notification = await notificationClient({
      eventId: paymentEvent.event_id, payment, message,
    });
    logger.log(JSON.stringify({
      event: 'notification.sent',
      booking_id: payment.booking_id,
      payment_event_id: paymentEvent.event_id,
      notification_id: notification.notification_id,
      status: notification.status,
    }));
    return notification;
  };
}
