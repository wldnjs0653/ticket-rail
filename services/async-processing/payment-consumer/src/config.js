function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (!value || String(value).trim() === '') throw new Error(`${name} is required`);
  return String(value).trim();
}

export function loadConfig() {
  return {
    brokers: required('KAFKA_BROKERS').split(',').map((item) => item.trim()),
    clientId: required('KAFKA_CLIENT_ID', 'ticketing-payment-consumer'),
    groupId: required('KAFKA_GROUP_ID', 'ticketing-payment-consumer-v1'),
    bookingTopic: required('BOOKING_TOPIC', 'booking.created'),
    paymentTopic: required('PAYMENT_TOPIC', 'payment.completed'),
    mockPaymentUrl: required('MOCK_PAYMENT_URL'),
    httpPort: Number.parseInt(required('HTTP_PORT', '8082'), 10),
  };
}
