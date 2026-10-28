const { randomUUID } = require('node:crypto');

function readEvent(messageValue, expectedType, requiredPayloadFields = []) {
  let event;
  try {
    event = JSON.parse(messageValue.toString());
  } catch {
    throw new Error('invalid_event_json');
  }

  if (!event || typeof event !== 'object') {
    throw new Error('invalid_event_envelope');
  }
  if (!event.event_id || !event.event_type || !event.occurred_at) {
    throw new Error('missing_event_envelope_fields');
  }
  if (expectedType && event.event_type !== expectedType) {
    throw new Error(`unexpected_event_type:${event.event_type}`);
  }

  const payload = event.payload;
  if (!payload || typeof payload !== 'object') {
    throw new Error('missing_event_payload');
  }
  for (const field of requiredPayloadFields) {
    if (payload[field] === undefined || payload[field] === null || payload[field] === '') {
      throw new Error(`missing_payload_field:${field}`);
    }
  }

  return { event, payload };
}

function createEvent(eventType, aggregateId, payload, eventId = randomUUID()) {
  return {
    event_id: eventId,
    event_type: eventType,
    aggregate_id: String(aggregateId),
    occurred_at: new Date().toISOString(),
    version: 1,
    payload,
  };
}

module.exports = { readEvent, createEvent };
