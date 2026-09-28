const { createConsumer, publish } = require('../clients/kafkaClient');
const pool = require('../clients/pgClient');
const mockPayment = require('../mock/mockPayment');
const config = require('../config');
const { readEvent, createEvent } = require('../events/eventContract');

async function findPayment(bookingId) {
  const result = await pool.query(
    `SELECT id, booking_id, status, amount, processed_at
       FROM payment
      WHERE booking_id = $1`,
    [bookingId]
  );
  return result.rows[0];
}

async function createPaymentOnce(data) {
  const existing = await findPayment(data.booking_id);
  if (existing) return existing;

  await mockPayment.charge(data);

  const inserted = await pool.query(
    `INSERT INTO payment (booking_id, status, amount, processed_at)
     VALUES ($1, 'APPROVED', $2, now())
     ON CONFLICT (booking_id) DO NOTHING
     RETURNING id, booking_id, status, amount, processed_at`,
    [data.booking_id, data.amount]
  );

  if (inserted.rowCount > 0) return inserted.rows[0];
  return findPayment(data.booking_id);
}

async function markProcessed(eventId) {
  await pool.query(
    `INSERT INTO processed_event (event_id, event_type)
     VALUES ($1, $2)
     ON CONFLICT (event_id) DO NOTHING`,
    [eventId, config.topics.bookingCreated]
  );
}

async function handleBookingCreated(message) {
  const { event, payload } = readEvent(
    message.value,
    config.topics.bookingCreated,
    ['booking_id', 'user_id', 'seat_id', 'ticket_event_id', 'amount']
  );

  const payment = await createPaymentOnce(payload);
  await markProcessed(event.event_id);

  const completedEvent = createEvent(
    config.topics.paymentCompleted,
    payload.booking_id,
    {
      ...payload,
      payment_id: payment.id,
      payment_status: payment.status,
      approved_at: payment.processed_at,
    },
    `payment.completed:booking:${payload.booking_id}`
  );

  // 결제는 이미 저장됐더라도 항상 다시 발행한다. 이전 발행 직후 장애가 났다면
  // Kafka가 booking.created를 재전달하며 이 지점에서 후속 이벤트를 복구한다.
  await publish(config.topics.paymentCompleted, completedEvent);
  console.log(
    `[payment-consumer] booking_id=${payload.booking_id} payment_id=${payment.id} 결제 완료 이벤트 발행`
  );
}

async function startPaymentConsumer() {
  const consumer = createConsumer('payment');
  await consumer.connect();
  await consumer.subscribe({
    topic: config.topics.bookingCreated,
    fromBeginning: false,
  });

  await consumer.run({
    eachMessage: async ({ message }) => {
      try {
        await handleBookingCreated(message);
      } catch (err) {
        console.error('[payment-consumer] 처리 실패, Kafka 재시도 대기:', err.message);
        throw err;
      }
    },
  });

  console.log('[payment-consumer] started, listening on', config.topics.bookingCreated);
  return consumer;
}

module.exports = { startPaymentConsumer, handleBookingCreated };
