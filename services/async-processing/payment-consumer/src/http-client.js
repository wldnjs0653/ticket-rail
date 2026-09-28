export function createPaymentClient({ baseUrl, timeoutMs = 5000 }) {
  return async ({ eventId, booking }) => {
    const response = await fetch(`${baseUrl}/payments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': eventId },
      body: JSON.stringify({
        booking_id: booking.booking_id,
        user_id: booking.user_id,
        amount: booking.amount,
        currency: booking.currency ?? 'KRW',
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`Mock Payment returned HTTP ${response.status}`);
    return response.json();
  };
}
