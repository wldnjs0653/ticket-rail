export function createNotificationClient({ baseUrl, timeoutMs = 5000 }) {
  return async ({ eventId, payment, message }) => {
    const response = await fetch(`${baseUrl}/notifications`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': eventId },
      body: JSON.stringify({
        booking_id: payment.booking_id,
        user_id: payment.user_id,
        channel: 'EMAIL',
        message,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`Mock Notification returned HTTP ${response.status}`);
    return response.json();
  };
}
