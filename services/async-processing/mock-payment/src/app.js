import { createHash, randomUUID } from 'node:crypto';
import express from 'express';

function defaultIdFactory(idempotencyKey) {
  if (!idempotencyKey) return randomUUID();
  const digest = createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 24);
  return `payment-${digest}`;
}

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function validatePaymentRequest(body) {
  const errors = [];

  if (!hasValue(body.booking_id)) {
    errors.push('booking_id is required');
  }

  if (!hasValue(body.user_id)) {
    errors.push('user_id is required');
  }

  if (!Number.isInteger(body.amount) || body.amount <= 0) {
    errors.push('amount must be a positive integer');
  }

  if (
    body.currency !== undefined &&
    (typeof body.currency !== 'string' || body.currency.length !== 3)
  ) {
    errors.push('currency must be a three-letter code');
  }

  return errors;
}

export function createApp({ idFactory = defaultIdFactory, now = () => new Date() } = {}) {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));

  app.get('/health/live', (_request, response) => {
    response.status(200).json({ status: 'UP' });
  });

  app.get('/health/ready', (_request, response) => {
    response.status(200).json({ status: 'READY' });
  });

  app.post('/payments', (request, response) => {
    const body = request.body ?? {};
    const errors = validatePaymentRequest(body);

    if (errors.length > 0) {
      return response.status(400).json({
        code: 'INVALID_PAYMENT_REQUEST',
        message: 'The payment request is invalid.',
        errors,
      });
    }

    return response.status(200).json({
      payment_id: idFactory(request.get('idempotency-key')),
      booking_id: body.booking_id,
      user_id: body.user_id,
      amount: body.amount,
      currency: (body.currency ?? 'KRW').toUpperCase(),
      status: 'SUCCEEDED',
      processed_at: now().toISOString(),
    });
  });

  app.use((error, _request, response, _next) => {
    if (error instanceof SyntaxError && 'body' in error) {
      return response.status(400).json({
        code: 'INVALID_JSON',
        message: 'The request body must be valid JSON.',
      });
    }

    console.error(error);
    return response.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
    });
  });

  return app;
}
