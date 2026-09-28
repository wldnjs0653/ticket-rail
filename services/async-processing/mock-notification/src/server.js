import { createApp } from './app.js';

const port = Number.parseInt(process.env.PORT ?? '8081', 10);
const app = createApp();

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Mock Notification is listening on port ${port}`);
});

function shutdown(signal) {
  console.log(`${signal} received. Shutting down Mock Notification.`);
  server.close((error) => {
    if (error) {
      console.error(error);
      process.exit(1);
    }

    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

