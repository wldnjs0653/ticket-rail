const { createConsumer, publish } = require('../clients/kafkaClient');
const pool = require('../clients/pgClient');
const mockNotification = require('../mock/mockNotification');
const config = require('../config');
const { readEvent, createEvent } = require('../events/eventContract');

async function wasProcessed(eventId) {
  const result = await pool.query(
    'SELECT 1 FROM processed_event WHERE event_id = $1',
    [eventId]
  );
  return result.rowCount > 0;
}

async function markProcessed(eventId) {
  await pool.query(
    `INSERT INTO processed_event (event_id, event_type)
     VALUES ($1, $2)
     ON CONFLICT (event_id) DO NOTHING`,
    [eventId, config.topics.paymentCompleted]
  );
}

async function handlePaymentCompleted(message) {
  const { event, payload } = readEvent(
    message.value,
    config.topics.paymentCompleted,
    ['booking_id', 'user_id', 'ticket_event_id', 'payment_id', 'payment_status']
  );

  if (await wasProcessed(event.event_id)) {
    console.log(
      `[notification-consumer] booking_id=${payload.booking_id} 이미 발송된 알림, 건너뜀`
    );
    return;
  }

  const notification = await mockNotification.send({
    booking_id: payload.booking_id,
    event_id: payload.ticket_event_id,
    user_id: payload.user_id,
    payment_id: payload.payment_id,
  });

  // 알림 전송이 성공한 뒤에만 완료 기록을 남긴다. 실패 시 예외가 위로 전달되어
  // Kafka가 같은 payment.completed 이벤트를 다시 처리한다.
  await markProcessed(event.event_id);

  const auditEvent = createEvent(
    config.topics.notificationRequested,
    payload.booking_id,
    {
      ...payload,
      notification_id: notification.notification_id,
      channel: notification.channel,
      sent_at: notification.sent_at,
    },
    `notification.sent:booking:${payload.booking_id}`
  );

  // 감사용 토픽 발행 실패가 이미 끝난 사용자 알림을 되돌리지는 않는다.
  try {
    await publish(config.topics.notificationRequested, auditEvent);
  } catch (err) {
    console.error('[notification-consumer] 감사 이벤트 발행 실패:', err.message);
  }

  console.log(
    `[notification-consumer] booking_id=${payload.booking_id} 알림 발송 완료 (${notification.notification_id})`
  );
}

async function startNotificationConsumer() {
  const consumer = createConsumer('notification');
  await consumer.connect();
  await consumer.subscribe({
    topic: config.topics.paymentCompleted,
    fromBeginning: false,
  });

  await consumer.run({
    eachMessage: async ({ message }) => {
      try {
        await handlePaymentCompleted(message);
      } catch (err) {
        console.error('[notification-consumer] 처리 실패, Kafka 재시도 대기:', err.message);
        throw err;
      }
    },
  });

  console.log('[notification-consumer] started, listening on', config.topics.paymentCompleted);
  return consumer;
}

module.exports = { startNotificationConsumer, handlePaymentCompleted };
