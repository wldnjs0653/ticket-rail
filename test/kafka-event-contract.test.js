const test = require('node:test');
const assert = require('node:assert/strict');
const { readEvent, createEvent } = require('../src/events/eventContract');

test('Kafka 이벤트 봉투와 payload를 읽는다', () => {
  const source = createEvent('booking.created', 10, {
    booking_id: 10,
    user_id: 7,
    seat_id: 3,
    ticket_event_id: 1,
    amount: 50000,
  }, 'event-1');

  const result = readEvent(
    Buffer.from(JSON.stringify(source)),
    'booking.created',
    ['booking_id', 'user_id', 'seat_id', 'ticket_event_id', 'amount']
  );

  assert.equal(result.event.event_id, 'event-1');
  assert.equal(result.payload.booking_id, 10);
});

test('필수 payload가 빠지면 거부한다', () => {
  const source = createEvent('booking.created', 10, { booking_id: 10 }, 'event-2');
  assert.throws(
    () => readEvent(Buffer.from(JSON.stringify(source)), 'booking.created', ['amount']),
    /missing_payload_field:amount/
  );
});

test('예상하지 않은 이벤트 타입을 거부한다', () => {
  const source = createEvent('payment.completed', 10, { booking_id: 10 }, 'event-3');
  assert.throws(
    () => readEvent(Buffer.from(JSON.stringify(source)), 'booking.created', ['booking_id']),
    /unexpected_event_type:payment.completed/
  );
});
