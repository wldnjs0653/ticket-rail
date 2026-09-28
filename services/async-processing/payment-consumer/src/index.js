import { Kafka, logLevel } from 'kafkajs';
import { loadConfig } from './config.js';
import { createPaymentHandler } from './handler.js';
import { startHealthServer } from './health.js';
import { createPaymentClient } from './http-client.js';

const config = loadConfig();
let ready = false;
let shuttingDown = false;
const kafka = new Kafka({
  clientId: config.clientId,
  brokers: config.brokers,
  logLevel: logLevel.INFO,
  retry: { initialRetryTime: 300, retries: 10 },
});
const consumer = kafka.consumer({ groupId: config.groupId });
const producer = kafka.producer({ allowAutoTopicCreation: false });
const healthServer = startHealthServer({ port: config.httpPort, isReady: () => ready });
const handlePayment = createPaymentHandler({
  paymentClient: createPaymentClient({ baseUrl: config.mockPaymentUrl }),
  publishPaymentCompleted: async (event) => producer.send({
    topic: config.paymentTopic,
    messages: [{
      key: String(event.aggregate_id),
      value: JSON.stringify(event),
      headers: { 'event-type': event.event_type },
    }],
  }),
});

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  ready = false;
  console.log(JSON.stringify({ event: 'shutdown.started', signal }));
  healthServer.close();
  await consumer.disconnect();
  await producer.disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

async function main() {
  await producer.connect();
  await consumer.connect();
  await consumer.subscribe({ topic: config.bookingTopic, fromBeginning: false });
  ready = true;
  console.log(JSON.stringify({
    event: 'payment-consumer.ready', brokers: config.brokers, topic: config.bookingTopic,
  }));
  await consumer.run({
    partitionsConsumedConcurrently: 3,
    eachMessage: async ({ message }) => {
      if (message.value !== null) await handlePayment(message.value);
    },
  });
}
main().catch((error) => {
  ready = false;
  console.error(error);
  process.exit(1);
});
