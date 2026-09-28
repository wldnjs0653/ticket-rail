function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (!value || String(value).trim() === '') throw new Error(`${name} is required`);
  return String(value).trim();
}

export function loadConfig() {
  return {
    brokers: required('KAFKA_BROKERS').split(',').map((item) => item.trim()),
    clientId: required('KAFKA_CLIENT_ID', 'ticketing-notification-consumer'),
    groupId: required('KAFKA_GROUP_ID', 'ticketing-notification-consumer-v1'),
    paymentTopic: required('PAYMENT_TOPIC', 'payment.completed'),
    mockNotificationUrl: required('MOCK_NOTIFICATION_URL'),
    httpPort: Number.parseInt(required('HTTP_PORT', '8083'), 10),
  };
}
