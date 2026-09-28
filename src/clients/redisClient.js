// @author gyustar
// @date 2026-09-03
//
// Redis 클라이언트
//
// Redis는 "빠르지만 휘발성"인 저장소다. 서버가 재시작되거나 TTL(유효시간)이
// 지나면 데이터가 사라질 수 있다. 그래서 이 프로젝트에서는 "잠깐 있다가
// 없어져도 괜찮은 데이터"만 Redis에 둔다:
//   - 대기열 순번 (queue.js)
//   - 입장 허용 여부 (auth.js)
//   - 좌석 임시 Hold (seat.js)
//   - Idempotency-Key로 캐싱한 응답 (middleware/idempotency.js)
//
// 반대로 "영원히 남아있어야 하는 사실"(누가 어느 좌석을 예매했는가)은
// Redis가 아니라 PostgreSQL(pgClient.js)에 저장한다.
//
// 이 클러스터는 Redis Sentinel 구성(Primary 1 + Replica 2 + Sentinel 3)이다.
// Sentinel이 Primary 장애를 감지하면 Replica 중 하나를 자동 승격시키고,
// ioredis가 새 Primary로 자동 재연결한다.

const Redis = require('ioredis');
const config = require('../config');
// 접속 모드 분기
// sentinel(기본) : K8s 환경. Sentinel 경유로 Primary를 찾아 붙인다
// direct : 로컬 개발. 터널로 오픈한 127.0.0.1:6379에 단독 붙인다
// Sentinel 에서 보는 master 주소는 pod 내부 IP이기 때문에 클러스터 외부(.115)에서는 터널 통과하여도 붙을 수 없다
// 로컬에서는 direct 모드로 단일 인스턴스에 붙는다.
const REDIS_MODE = process.env.REDIS_MODE || 'sentinel';


// 재연결 및 재시도 정책은 두 모드 공통
// 연결이 끊기면 자동으로 재연결 시도한다.
// 시도할 때마다 대기 시간을 조금 씩 늘려서 (200ms, 400ms, 600ms 등) 서버에 부담이 덜 가도록
// 최대 3000ms 까지만 늘어나고 그 이상은 늘리지 않는다.
// 요청 하나가 실패했을 경우 최대 3번까지만 재시도(무한루프방지)
const commonOptions = {
  retryStrategy: (times) => Math.min(times * 200, 3000),
  maxRetriesPerRequest: 3,
};

// ioredis를 모드에 따라 다르게 생성한다.
// sentinel : Sentinel 프로세스 주소 목록 (최소 1개, 보통 3개)
// name : Sentinel이 관리하는 master 그룹이름
// password : Redis 데이터 노드 인증 패스워드
// sentinelsPassword : Sentinel 자체 인증 비밀번호
const redis =
  REDIS_MODE === 'direct'
    ? new Redis({
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: process.env.REDIS_PORT || 6379,
        password: process.env.REDIS_PASSWORD,
        ...commonOptions
      })
    : new Redis({
        sentinels: config.redis.sentinels,
        name: config.redis.name,
        password: config.redis.password,
        sentinelPassword: config.redis.sentinelPassword,
        ...commonOptions
      });

// 연결 중 오류가 나면 콘솔에 로그만 남긴다.
// 여기서 서버를 죽이지 않는 이유: Redis가 잠깐 끊겨도 서버 전체가
// 다운되면 안 되기 때문이다. 실제로 이 값을 쓰는 라우트(queue.js 등)에서
// 오류가 나면 그때 그 요청만 실패 응답을 보내면 된다.
redis.on('error', (err) => {
  console.error('[redis] connection error:', err.message);
});

redis.on('connect', () => {
  if (REDIS_MODE === 'direct') {
    console.log('[redis] connected in direct mode:',
      `${process.env.REDIS_HOST || '127.0.0.1'}:${process.env.REDIS_PORT || 6379}`);
  } else {
    console.log('[redis] connected to sentinel master:', config.redis.name);
  }
});

// Sentinel이 Primary를 전환(failover)하면 이 이벤트가 발생한다.
redis.on('+switch-master', () => {
  console.log('[redis] sentinel failover detected, reconnecting to new master');
});

module.exports = redis;
