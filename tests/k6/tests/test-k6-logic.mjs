import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const count = (h, metric) => h.points.filter(p => p.metric === metric).reduce((n,p) => n+p.value, 0);
const samples = (h, metric) => h.points.filter(p => p.metric === metric);
let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log('PASS ' + name);
}

async function harness(entry, env = {}, responseFactory = null, virtualFiles = {}) {
  const points = [], requests = [], checks = [];
  let now = Date.UTC(2026,8,9);
  class Clock extends Date { static now() { return now; } }
  class Metric {
    constructor(name) { this.name = name; }
    add(value, tags = {}) { points.push({ metric: this.name, value: Number(value), tags, time: now }); }
  }
  const execution = { scenario: { iterationInTest: 0 }, vu: { idInTest: 1 },
    instance: { currentTestRunDuration: 0 } };
  const http = {
    expectedStatuses: (...codes) => status => codes.some(c => typeof c === 'number'
      ? c === status : status >= c.min && status <= c.max),
    setResponseCallback: () => {},
    request(method, url, payload, params) {
      const req = { method, url, body: payload === null ? null : JSON.parse(payload), params };
      requests.push(req);
      const raw = responseFactory ? responseFactory(req, requests.length) : { status: 200, body: { status: 'ok' } };
      if (raw.throw) throw new Error('mock transport error');
      now += raw.elapsed ?? 20;
      const r = {
        status: raw.status, body: typeof raw.body === 'string' ? raw.body : JSON.stringify(raw.body ?? {}),
        timings: { duration: raw.elapsed ?? 20 },
        json(key) { const obj = JSON.parse(this.body); return key ? obj[key] : obj; },
      };
      points.push({ metric: 'http_req_failed', value: Number(!params.responseCallback(r.status)),
        tags: params.tags, time: now });
      return r;
    },
    get(url, params) { return this.request('GET', url, null, params); },
  };
  const context = vm.createContext({
    __ENV: { BASE_URL: 'http://mock.local', ...env }, Date: Clock,
    console: { log() {}, warn() {} },
    open: file => virtualFiles[file] ?? fs.readFileSync(path.resolve(root,'scenarios',file),'utf8'),
  });
  const builtins = {
    'k6/http': { default: http },
    'k6/metrics': { Counter: Metric, Rate: Metric, Trend: Metric },
    'k6/data': { SharedArray: class { constructor(_name, fn) { return fn(); } } },
    'k6/execution': { default: execution },
    'k6': { sleep: seconds => { now += seconds*1000; }, check: (response, map, tags) => {
      const result = Object.entries(map).every(([name, fn]) => {
        const ok = fn(response); checks.push({ name, ok, tags }); return ok;
      });
      return result;
    } },
  };
  const modules = new Map();
  function getModule(id) {
    if (modules.has(id)) return modules.get(id);
    let mod;
    if (builtins[id]) {
      const data = builtins[id];
      mod = new vm.SyntheticModule(Object.keys(data), function () {
        for (const [key,value] of Object.entries(data)) this.setExport(key,value);
      }, { context, identifier: id });
    } else {
      mod = new vm.SourceTextModule(fs.readFileSync(id,'utf8'), { context, identifier: id });
    }
    modules.set(id,mod);
    return mod;
  }
  const mod = getModule(path.join(root,entry));
  await mod.link((spec, ref) => getModule(spec.startsWith('k6') ? spec : path.resolve(path.dirname(ref.identifier),spec)));
  await mod.evaluate();
  return { mod: mod.namespace, points, requests, checks, execution, context,
    now: () => now, rootModule: mod };
}

const healthy = req => req.url.endsWith('/queue/join') ? { status:202, body:{token:'t'} }
  : req.url.endsWith('/auth/verify') ? {status:200,body:{status:'admitted'}}
  : req.url.endsWith('/hold') ? {status:200,body:{}}
  : req.url.endsWith('/bookings') ? {status:201,body:{booking_id:1}}
  : {status:200,body:{status:'ok'}};

await test('normal booking: four endpoints, one completed successful flow', async () => {
  const h = await harness('scenarios/booking-stream.js', {}, healthy);
  h.mod.default();
  assert.equal(h.requests.length,4);
  assert.equal(count(h,'flow_started'),1);
  assert.equal(count(h,'flow_completed'),1);
  assert.equal(count(h,'flow_successes'),1);
  assert.equal(count(h,'flow_failed'),0);
  assert.equal(count(h,'http_req_failed'),0);
  assert.equal(new Set(h.requests.filter(r=>r.params.headers['Idempotency-Key'])
    .map(r=>r.params.headers['Idempotency-Key'])).size,3);
});
for (const [step, idx] of [['queue_join',1],['auth_verify',2],['seat_hold',3],['booking',4]]) {
  await test('booking failure at ' + step + ' is retained in flow denominator', async () => {
    const h = await harness('scenarios/booking-stream.js', {}, (r,i) => i===idx ? {status:503,body:{}} : healthy(r));
    h.mod.default();
    assert.equal(h.requests.length,idx);
    assert.equal(count(h,'flow_started'),1);
    assert.equal(count(h,'flow_completed'),1);
    assert.equal(count(h,'flow_failed'),1);
    assert.equal(samples(h,'flow_failed')[0].tags.failed_step,step);
  });
}
await test('queue 409 is HTTP failure; seat 409 is a conflict and failed booking flow', async () => {
  for (const failAt of [1,3]) {
    const h = await harness('scenarios/booking-stream.js', {}, (r,i)=>i===failAt ? {status:409,body:{}} : healthy(r));
    h.mod.default();
    assert.equal(count(h,'http_req_failed'),failAt===1 ? 1 : 0);
    assert.equal(count(h,'flow_failed'),1);
    assert.equal(count(h,'flow_conflicts'),failAt===3 ? 1 : 0);
  }
});
await test('booking 200 cannot pass the expected 201 contract', async () => {
  const h = await harness('scenarios/booking-stream.js', {}, (r,i)=>i===4 ? {status:200,body:{}} : healthy(r));
  h.mod.default();
  assert.equal(count(h,'flow_failed'),1);
  assert.equal(count(h,'http_req_failed'),1);
});
await test('verify 200 with missing/malformed body does not admit the user', async () => {
  for (const body of [{},'not-json']) {
    const h=await harness('scenarios/booking-stream.js',{},(r,i)=>i===2 ? {status:200,body} : healthy(r));
    h.mod.default();
    assert.equal(h.requests.length,2);
    assert.equal(count(h,'flow_failed'),1);
    assert.equal(count(h,'http_req_failed'),0); // body failure is a flow failure, not a status failure.
  }
});
await test('500 with waiting body cannot enter a success polling branch', async () => {
  const h=await harness('scenarios/booking-stream.js',{},(r,i)=>i===2 ? {status:500,body:{status:'waiting'}} : healthy(r));
  h.mod.default();
  assert.equal(h.requests.length,2);
  assert.equal(count(h,'flow_failed'),1);
});
await test('verify expiration is a failure, not an allowed conflict', async () => {
  const h=await harness('scenarios/booking-stream.js',{},(r,i)=>i===2 ? {status:401,body:{}} : healthy(r));
  h.mod.default();
  assert.equal(count(h,'http_req_failed'),1);
  assert.equal(count(h,'flow_conflicts'),0);
});
await test('waiting is bounded by configured deadline without a full final sleep', async () => {
  const h=await harness('scenarios/booking-stream.js',
    {QUEUE_MAX_WAIT_SECONDS:'0.2',QUEUE_POLL_INTERVAL_SECONDS:'1'},
    (r,i)=>i===1 ? healthy(r) : {status:202,body:{status:'waiting'},elapsed:20});
  const start=h.now();
  h.mod.default();
  assert.equal(h.now()-start,220);
  assert.equal(h.requests.length,2);
  assert.equal(count(h,'flow_failed'),1);
  assert.equal(h.requests[1].params.timeout,'200ms');
});
await test('transport exception still records failed/completed flow', async () => {
  const h=await harness('scenarios/booking-stream.js',{},()=>({throw:true}));
  assert.throws(()=>h.mod.default(),/mock transport error/);
  assert.equal(count(h,'flow_failed'),1);
  assert.equal(count(h,'flow_completed'),1);
});
await test('rate and VU budget cover all Redis iteration steps', async () => {
  const h=await harness('scenarios/queue-load.js',{EVENT_ID:'1',TEST_MODE:'failover',
    FAILOVER_RATE:'2',QUEUE_MAX_WAIT_SECONDS:'5',AFTER_ADMISSION_PATH:'/seats/{eventId}'},healthy);
  const s=h.mod.options.scenarios.redis_failover;
  assert.equal(s.executor,'constant-arrival-rate');
  assert.equal(s.preAllocatedVUs,27); // 2/s * (2s join + 5s verify budget + 2s GET) * 1.5
  const start=h.now();h.mod.default();
  assert.equal(h.requests.length,3);
  assert.equal(h.now()-start,60); // no end-of-iteration sleep for arrival rate
  assert.equal(count(h,'flow_successes'),1);
});
await test('Redis failure before verify appears in whole-flow result',async()=>{
  const h=await harness('scenarios/queue-load.js',{EVENT_ID:'1',TEST_MODE:'failover'},()=>({status:503}));
  h.mod.default();assert.equal(count(h,'flow_failed'),1);assert.equal(h.requests.length,1);
});
await test('strict numeric configuration rejects partial integers',async()=>{
  for (const value of ['2x','2.5','-1','0','9007199254740993']) {
    await assert.rejects(harness('scenarios/booking-stream.js',{BOOKING_RATE:value}),/정수/);
  }
});
await test('insufficient case count and duplicate seat/user data fail before requests',async()=>{
  await assert.rejects(harness('scenarios/booking-stream.js',{BOOKING_DURATION:'4s'}),/최소 4개/);
  const dup=JSON.stringify([{user_id:1,event_id:1,seat_id:1},{user_id:2,event_id:1,seat_id:1}]);
  await assert.rejects(harness('scenarios/booking-stream.js',
    {BOOKING_CASES_FILE:'cases.json'},null,{'cases.json':dup}),/같은 좌석/);
  const dupUser=JSON.stringify([{user_id:1,event_id:1,seat_id:1},{user_id:1,event_id:1,seat_id:2}]);
  await assert.rejects(harness('scenarios/booking-stream.js',
    {BOOKING_CASES_FILE:'cases.json'},null,{'cases.json':dupUser}),/다른 사용자/);
});
await test('invalid VU/grace settings and obsolete FAILOVER_VUS are rejected',async()=>{
  await assert.rejects(harness('scenarios/booking-stream.js',{PRE_ALLOCATED_VUS:'10',MAX_VUS:'9'}),/MAX_VUS/);
  await assert.rejects(harness('scenarios/booking-stream.js',{GRACEFUL_STOP:'1s'}),/시간 예산/);
  await assert.rejects(harness('scenarios/load.js',
    {TARGET_PATH:'/seats/1',TEST_MODE:'failover',FAILOVER_VUS:'10'}),/FAILOVER_VUS/);
});
await test('smoke respects Ingress Host and rejects a wrong 2xx status',async()=>{
  const h=await harness('scenarios/smoke.js',
    {REQUEST_HEADERS_JSON:'{"Host":"tickets.test"}'},()=>({status:204,body:{status:'ok'}}));
  h.mod.default();
  assert.equal(h.requests[0].params.headers.Host,'tickets.test');
  assert.equal(count(h,'http_req_failed'),1);
  assert.ok(h.checks.some(c=>!c.ok));
});
await test('standard ramp plan remains 35 minutes; fault load has no think-time sleep',async()=>{
  const h=await harness('scenarios/load.js',{TARGET_PATH:'/seats/1'},healthy);
  const stages=h.mod.options.scenarios.staged_load.stages;
  const duration=stages.reduce((sum,s)=>sum+parseFloat(s.duration)*(s.duration.endsWith('m')?60:1),0);
  assert.equal(duration,2100);
  const f=await harness('scenarios/load.js',{TARGET_PATH:'/seats/1',TEST_MODE:'failover'},healthy);
  const start=f.now();f.mod.default();assert.equal(f.now()-start,20);
});
await test('same-seat test rejects duplicate users and records one winner',async()=>{
  await assert.rejects(harness('scenarios/seat-concurrency.js',
    {EVENT_ID:'1',SEAT_ID:'1',USER_IDS:'1,1'}),/중복/);
  let held=false;
  const h=await harness('scenarios/seat-concurrency.js',
    {EVENT_ID:'1',SEAT_ID:'1',USER_IDS:'1,2'},
    req=>{
      if(req.url.endsWith('/hold')) {const result=held?{status:409}:{status:200};held=true;return result;}
      return healthy(req);
    });
  const data=h.mod.setup();
  h.mod.default(data);h.execution.vu.idInTest=2;h.mod.default(data);
  assert.equal(count(h,'hold_successes'),1);
  assert.equal(count(h,'hold_conflicts'),1);
  assert.equal(count(h,'booking_successes'),1);
  assert.equal(count(h,'http_req_failed'),0);
});
await test('e2e uses full booking flow and fails on admission failure',async()=>{
  const env={EVENT_ID:'1',SEAT_ID:'1',USER_ID:'1'};
  const h=await harness('scenarios/e2e.js',env,healthy);h.mod.default();
  assert.equal(count(h,'flow_successes'),1);
  const f=await harness('scenarios/e2e.js',env,(r,i)=>i===2?{status:500}:healthy(r));
  assert.throws(()=>f.mod.default(),/auth_verify/);
  assert.equal(count(f,'flow_failed'),1);
});
await test('HTTP probe requires target and preserves exact expected status',async()=>{
  await assert.rejects(harness('scenarios/http-continuity-probe.js'),/TARGET_URL/);
  const h=await harness('scenarios/http-continuity-probe.js',
    {TARGET_URL:'http://mock.local/healthz',EXPECTED_STATUS_CODES:'204'},()=>({status:200}));
  h.mod.default();
  assert.equal(count(h,'probe_failed'),1);assert.equal(count(h,'http_req_failed'),1);
  assert.equal(h.mod.options.scenarios.continuity_probe.preAllocatedVUs,3);
});
await test('default queue allows more than five seconds; VU default stays bounded',async()=>{
  const h=await harness('scenarios/booking-stream.js',{},(r,i)=>{
    if(r.url.endsWith('/auth/verify') && i<8) return {status:202,body:{status:'waiting'}};
    return healthy(r);
  });
  const start=h.now();h.mod.default();
  assert.ok(h.now()-start>5000);
  assert.equal(count(h,'flow_successes'),1);
  assert.equal(h.mod.options.scenarios.booking_stream.preAllocatedVUs,100);
  assert.equal(h.mod.options.scenarios.booking_stream.gracefulStop,'608s');
  const q=await harness('scenarios/queue-load.js',{EVENT_ID:'1'},healthy);
  assert.equal(q.mod.options.scenarios.queue_load.gracefulStop,'604s');
});
console.log('JavaScript logic regression: ' + passed + ' passed. k6 runtime is mocked.');
