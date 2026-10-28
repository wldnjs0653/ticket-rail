// @author gyustar
// Consumer 전용 프로세스 진입점

const http = require('node:http');
const {
  startPaymentConsumer,
} = require('./paymentConsumer');
const {
  startNotificationConsumer,
} = require('./notificationConsumer');
const {
  disconnectProducer,
} = require('../clients/kafkaClient');
const pool = require('../clients/pgClient');

const PORT = Number.parseInt(
  process.env.PORT || '8084',
  10
);

const consumerRole = (
  process.env.CONSUMER_ROLE || 'all'
).toLowerCase();

const validRoles = new Set([
  'all',
  'payment',
  'notification',
]);

if (!validRoles.has(consumerRole)) {
  throw new Error(
    'CONSUMER_ROLE must be all, payment, or notification'
  );
}

let consumerReady = false;
let shuttingDown = false;
let runningConsumers = [];

const server = http.createServer(async (req, res) => {
  if (req.url === '/health/live') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
    });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (req.url === '/health/ready') {
    try {
      await pool.query('SELECT 1');

      res.writeHead(consumerReady ? 200 : 503, {
        'Content-Type': 'application/json',
      });

      res.end(JSON.stringify({
        consumer: consumerReady ? 'ok' : 'starting',
        role: consumerRole,
        postgres: 'ok',
      }));
    } catch (error) {
      res.writeHead(503, {
        'Content-Type': 'application/json',
      });

      res.end(JSON.stringify({
        consumer: consumerReady ? 'ok' : 'starting',
        role: consumerRole,
        postgres: 'fail',
      }));
    }

    return;
  }

  res.writeHead(404, {
    'Content-Type': 'application/json',
  });
  res.end(JSON.stringify({ error: 'not_found' }));
});

server.listen(PORT, () => {
  console.log(
    `[consumer-main] health server listening on ${PORT}`
  );
});

const enabledConsumers = [];

if (
  consumerRole === 'all' ||
  consumerRole === 'payment'
) {
  enabledConsumers.push({
    name: 'payment',
    start: startPaymentConsumer,
  });
}

if (
  consumerRole === 'all' ||
  consumerRole === 'notification'
) {
  enabledConsumers.push({
    name: 'notification',
    start: startNotificationConsumer,
  });
}

Promise.all(
  enabledConsumers.map(async ({ name, start }) => ({
    name,
    consumer: await start(),
  }))
)
  .then((startedConsumers) => {
    runningConsumers = startedConsumers;
    consumerReady = true;

    console.log(
      '[consumer-main] ready role=' +
      consumerRole +
      ' consumers=' +
      startedConsumers
        .map(({ name }) => name)
        .join(',')
    );
  })
  .catch((error) => {
    console.error(
      '[consumer-main] consumer startup failed:',
      error.message
    );
    process.exit(1);
  });

async function shutdown(signal) {
  if (shuttingDown) return;

  shuttingDown = true;
  consumerReady = false;

  console.log(
    `[consumer-main] ${signal} received`
  );

  server.close();

  await Promise.allSettled(
    runningConsumers.map(({ consumer }) =>
      consumer.disconnect()
    )
  );

  await Promise.allSettled([
    disconnectProducer(),
    pool.end(),
  ]);

  process.exit(0);
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    shutdown(signal).catch((error) => {
      console.error(
        '[consumer-main] shutdown failed:',
        error
      );
      process.exit(1);
    });
  });
}
