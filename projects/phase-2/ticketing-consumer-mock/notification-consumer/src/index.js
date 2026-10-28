import { Kafka, logLevel } from 'kafkajs';
import { loadConfig } from './config.js';
import { createNotificationHandler } from './handler.js';
import { startHealthServer } from './health.js';
import { createNotificationClient } from './http-client.js';

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
const healthServer = startHealthServer({ port: config.httpPort, isReady: () => ready });
const handleNotification = createNotificationHandler({
  notificationClient: createNotificationClient({ baseUrl: config.mockNotificationUrl }),
});

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  ready = false;
  console.log(JSON.stringify({ event: 'shutdown.started', signal }));
  healthServer.close();
  await consumer.disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

async function main() {
  await consumer.connect();
  await consumer.subscribe({ topic: config.paymentTopic, fromBeginning: false });
  ready = true;
  console.log(JSON.stringify({
    event: 'notification-consumer.ready', brokers: config.brokers, topic: config.paymentTopic,
  }));
  await consumer.run({
    partitionsConsumedConcurrently: 3,
    eachMessage: async ({ message }) => {
      if (message.value !== null) await handleNotification(message.value);
    },
  });
}
main().catch((error) => {
  ready = false;
  console.error(error);
  process.exit(1);
});
