// metrics.js
const client = require('prom-client');
// 2026-09-17 추가 2줄
const redis = require('./clients/redisClient');
const config = require('./config');

const register = new client.Registry();

// 여러 Pod를 구분하려면 라벨이 필요하다. K8s에서 POD_NAME은 downward API로 주입한다.
register.setDefaultLabels({
  app: 'ticketing-api',
  instance: process.env.POD_NAME || 'local',
});

// process CPU/메모리/GC/이벤트루프 지연 등 기본 지표
client.collectDefaultMetrics({ register });

// ---------------------------------------------------------------------------
// HTTP 공통 지표
// ---------------------------------------------------------------------------

const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'HTTP 요청 총 건수',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP 요청 처리 시간(초)',
  labelNames: ['method', 'route', 'status_code'],
  // 티켓팅은 짧은 응답이 대부분이라 하단 구간을 촘촘하게
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

const httpRequestsInFlight = new client.Gauge({
  name: 'http_requests_in_flight',
  help: '현재 처리 중인 HTTP 요청 수',
  registers: [register],
});

/**
 * 라벨 카디널리티 주의:
 * req.path를 쓰면 /bookings/1, /bookings/2 ... 가 전부 다른 시계열이 된다.
 * 반드시 라우트 패턴(req.route.path)을 쓴다. → '/bookings/:id'
 */
function metricsMiddleware(req, res, next) {
  // /metrics 자체는 집계에서 제외
  if (req.path === '/metrics') return next();

  httpRequestsInFlight.inc();
  const endTimer = httpRequestDuration.startTimer();

  res.on('finish', () => {
    const route =
      (req.route && req.baseUrl + req.route.path) || req.baseUrl || 'unknown';
    const labels = {
      method: req.method,
      route,
      status_code: res.statusCode,
    };

    httpRequestsTotal.inc(labels);
    endTimer(labels);
    httpRequestsInFlight.dec();
  });

  next();
}

// ---------------------------------------------------------------------------
// 티켓팅 도메인 지표
// ---------------------------------------------------------------------------

const seatHoldTotal = new client.Counter({
  name: 'ticketing_seat_hold_total',
  help: '좌석 선점 시도 결과',
  labelNames: ['result'], // success | conflict | not_found | error
  registers: [register],
});

const bookingTotal = new client.Counter({
  name: 'ticketing_booking_total',
  help: '예약 생성 결과',
  labelNames: ['result'], // confirmed | conflict | error
  registers: [register],
});

const idempotencyTotal = new client.Counter({
  name: 'ticketing_idempotency_total',
  help: 'Idempotency 처리 결과',
  labelNames: ['source'], // redis_hit | db_conflict | miss
  registers: [register],
});

const queueJoinTotal = new client.Counter({
  name: 'ticketing_queue_join_total',
  help: '대기열 진입 건수',
  registers: [register],
});

const kafkaPublishTotal = new client.Counter({
  name: 'ticketing_kafka_publish_total',
  help: 'Kafka 발행 결과',
  labelNames: ['topic', 'result'], // success | error
  registers: [register],
});

// ---------------------------------------------------------------------------
// 대기열 입장 정원 지표 (2026-09-16 추가, 2026-09-17 수정)
// 부하 시험에서 대기열 적체·해소를 관측하기 위한 것이다.
// event_id 라벨로 이벤트별 규모를 구분한다.
// ---------------------------------------------------------------------------

const queueAdmittedTotal = new client.Counter({
  name: 'ticketing_queue_admitted_total',
  help: '입장 허용 누적 건수',
  labelNames: ['event_id'],
  registers: [register],
});

const queueRejectedTotal = new client.Counter({
  name: 'ticketing_queue_rejected_total',
  help: '정원 초과로 대기(202) 처리된 건수',
  labelNames: ['event_id'],
  registers: [register],
});

const queueWaitSeconds = new client.Histogram({
  name: 'ticketing_queue_wait_seconds',
  help: '대기열 진입부터 입장 허용까지 걸린 시간(초)',
  labelNames: ['event_id'],
  buckets: [0.5, 1, 2, 5, 10, 20, 30, 60, 120],
  registers: [register],
});

// (2026-09-17) ticketing_queue_waiting 제거
//   대기자 수가 아닌 입장자 수가 기록되고, 202 응답 시점에만 갱신되던 문제.
//   실제 대기자 수는 대기자 목록 관리가 필요해 1차 범위에서 제외했다.

// 입장이 발생한 이벤트 ID 목록 (auth.js가 입장 시 기록)
const ADMISSION_EVENTS_KEY = 'queue:admission:events';

// 스크랩 시 Redis 조회 시간 제한(ms). Redis가 없거나 응답이 늦어도 /metrics 전체가 멈추지 않게 한다.
// (2026-09-17) CI처럼 Redis가 없는 환경에서 ioredis가 명령을 대기시켜 /metrics가 응답하지 않던 문제 대응
const METRICS_REDIS_TIMEOUT_MS = 1000;

function withRedisTimeout(promise) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('redis timeout')), METRICS_REDIS_TIMEOUT_MS)
    ),
  ]);
}

// Redis가 연결된 상태일 때만 조회한다. 미연결이면 즉시 빈 목록을 돌려준다.
async function getAdmissionEventIds() {
  if (redis.status !== 'ready') return [];
  return withRedisTimeout(redis.smembers(ADMISSION_EVENTS_KEY));
}

// 스크랩 시점에 Redis에서 조회하므로 요청이 없어도 최신 상태가 반영된다.
// 모든 Pod가 같은 Redis 값을 보고한다 → Grafana에서는 max by (event_id)로 조회한다.
// 조회만 하고 삭제하지 않는다(ZREMRANGEBYSCORE 대신 ZCOUNT).
const queueAdmittedCurrent = new client.Gauge({
  name: 'ticketing_queue_admitted_current',
  help: '현재 유효 입장자 수 (스크랩 시점 Redis 조회, Pod별 동일값 → max로 집계)',
  labelNames: ['event_id'],
  registers: [register],
  async collect() {
    this.reset();
    try {
      const minScore = Date.now() - config.admissionTtlSeconds * 1000;
      const eventIds = await getAdmissionEventIds();
      for (const eventId of eventIds) {
        const count = await withRedisTimeout(
          redis.zcount(`queue:${eventId}:admitted:set`, `(${minScore}`, '+inf')
        );
        this.set({ event_id: eventId }, count);
      }
    } catch (err) {
      // Redis 조회 실패가 /metrics 전체 실패로 번지지 않게 한다.
      console.error('[metrics] admitted_current 조회 실패', err.message);
    }
  },
});

const queueAdmissionLimit = new client.Gauge({
  name: 'ticketing_queue_admission_limit',
  help: '이벤트별 동시 입장 정원 (Pod별 동일값 → max로 집계)',
  labelNames: ['event_id'],
  registers: [register],
  async collect() {
    this.reset();
    try {
      const eventIds = await getAdmissionEventIds();
      for (const eventId of eventIds) {
        this.set({ event_id: eventId }, config.queueAdmissionLimit);
      }
    } catch (err) {
      console.error('[metrics] admission_limit 조회 실패', err.message);
    }
  },
});

module.exports = {
  register,
  metricsMiddleware,
  seatHoldTotal,
  bookingTotal,
  idempotencyTotal,
  queueJoinTotal,
  kafkaPublishTotal,
  queueAdmittedTotal,
  queueRejectedTotal,
  queueWaitSeconds,
  queueAdmittedCurrent,
  queueAdmissionLimit,
};