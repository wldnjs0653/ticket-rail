// @author gyustar
// @date 2026-09-11
//
// Consumer 전용 프로세스 진입점
//
// backend 파드는 server.js 로 API 를 제공하고, consumer 파드는 이 파일로
// 기동한다. 같은 이미지를 공유하되 command 로 진입점만 달리한다.
//
// K8s 의 readinessProbe / livenessProbe 가 HTTP 응답을 요구하므로
// 최소한의 health 서버를 함께 올린다.

const http = require('node:http');
const { startPaymentConsumer } = require('./paymentConsumer');
const { startNotificationConsumer } = require('./notificationConsumer');
const pool = require('../clients/pgClient');

const PORT = parseInt(process.env.PORT || '8084', 10);

let consumerReady = false;

const server = http.createServer(async (req, res) => {
  if (req.url === '/health/live') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (req.url === '/health/ready') {
    try {
      await pool.query('SELECT 1');
      res.writeHead(consumerReady ? 200 : 503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ consumer: consumerReady ? 'ok' : 'starting', postgres: 'ok' }));
    } catch (err) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ consumer: consumerReady ? 'ok' : 'starting', postgres: 'fail' }));
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found' }));
});

server.listen(PORT, () => {
  console.log(`[consumer-main] health server listening on ${PORT}`);
});

Promise.all([
  startPaymentConsumer(),
  startNotificationConsumer(),
])
  .then(() => {
    consumerReady = true;
    console.log('[consumer-main] payment and notification consumers ready');
  })
  .catch((err) => {
    console.error('[consumer-main] consumer 기동 실패 :', err.message);
    process.exit(1);
  });

process.on('SIGTERM', () => {
  console.log('[consumer-main] SIGTERM 수신, 종료 절차 시작');
  server.close();
  process.exit(0);
});
