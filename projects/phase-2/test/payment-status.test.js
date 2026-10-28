const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { classifyPayment, createPaymentTracker, createNotificationTracker } = require('../src/public/payment-status');

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function fixture(readPayment, createTracker = createPaymentTracker, settings = {}) {
  let clock = 100000;
  let id = 0;
  const tasks = new Map();
  const events = [];
  const tracker = createTracker({
    readPayment,
    now: () => clock,
    setTimeout(fn, delay) { const key = ++id; tasks.set(key, { fn, at: clock + delay }); return key; },
    clearTimeout(key) { tasks.delete(key); },
    onPending: bookingId => events.push(['pending', bookingId]),
    onApproved: payment => events.push(['approved', payment.booking_id]),
    onFailed: payment => events.push(['failed', payment.booking_id]),
    onConfirmed: payment => events.push(['notification', payment.booking_id]),
    ...settings,
  });
  async function advance(ms) {
    const end = clock + ms;
    await flush();
    for (let i = 0; i < 10000; i++) {
      const next = [...tasks].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      tasks.delete(next[0]); clock = next[1].at; next[1].fn(); await flush();
    }
    clock = end;
    await flush();
  }
  return { tracker, advance, events, tasks };
}

test('같은 예약의 APPROVED만 승인하며 HTTP 성공/알림/다른 예약은 승인 근거가 아니다', () => {
  for (const value of [null, {}, { booking_id: 7 }, { booking_id: 7, status: 'CONFIRMED', notification_sent: true }, { booking_id: 8, status: 'APPROVED' }]) {
    assert.equal(classifyPayment(value, 7), 'pending');
  }
  assert.equal(classifyPayment({ booking_id: 7, status: 'approved', notification_sent: false }, 7), 'approved');
  assert.equal(classifyPayment({ booking_id: 7, status: 'FAILED' }, 7), 'failed');
});

test('빠른 승인은 지연 화면/알림 완료 대기 없이 바로 완료한다', async () => {
  const f = fixture(async id => ({ booking_id: id, status: 'APPROVED', notification_sent: false }));
  f.tracker.start(7);
  await flush();
  assert.deepEqual(f.events, [['approved', 7]]);
  assert.equal(f.tasks.size, 0);
  await f.advance(20000);
  assert.equal(f.events.length, 1);
});

test('8초 지연 화면 후 40회 이상의 대기에서도 자동 조회를 계속하고 승인 시 전환한다', async () => {
  let approved = false;
  let reads = 0;
  const f = fixture(async id => { reads++; return approved ? { booking_id: id, status: 'APPROVED' } : null; });
  f.tracker.start(7);
  await f.advance(7999);
  assert.deepEqual(f.events, []);
  await f.advance(1);
  assert.deepEqual(f.events, [['pending', 7]]);
  await f.advance(90000);
  assert.ok(reads > 40);
  approved = true;
  await f.advance(1500);
  assert.deepEqual(f.events, [['pending', 7], ['approved', 7]]);
  assert.equal(f.tasks.size, 0);
});

test('통신 실패와 요청 타임아웃은 결제 실패로 오판하지 않는다', async () => {
  let reads = 0;
  const f = fixture(() => { reads++; if (reads === 1) throw new Error('offline'); return new Promise(() => {}); });
  f.tracker.start(7);
  await f.advance(15000);
  assert.deepEqual(f.events, [['pending', 7]]);
  assert.ok(reads >= 3);
  f.tracker.stop();
  assert.equal(f.tasks.size, 0);
});

test('명시적 승인 실패만 실패 화면으로 전환한다', async () => {
  const f = fixture(async id => ({ booking_id: id, status: 'DECLINED' }));
  f.tracker.start(7, { immediate: true });
  await flush();
  assert.deepEqual(f.events, [['pending', 7], ['failed', 7]]);
  assert.equal(f.tasks.size, 0);
});

test('수동 조회는 진행 중 요청과 중복되지 않으며 이전 예약의 늦은 응답은 무시한다', async () => {
  const callbacks = [];
  const f = fixture((id, signal) => new Promise(resolve => callbacks.push({ id, signal, resolve })));
  f.tracker.start(7, { immediate: true });
  f.tracker.checkNow(); f.tracker.checkNow();
  assert.equal(callbacks.length, 1);
  f.tracker.start(8, { immediate: true });
  assert.equal(callbacks[0].signal.aborted, true);
  callbacks[0].resolve({ booking_id: 7, status: 'APPROVED' });
  await flush();
  assert.equal(f.events.some(([event]) => event === 'approved'), false);
  callbacks[1].resolve({ booking_id: 8, status: 'APPROVED' });
  await flush();
  assert.deepEqual(f.events.at(-1), ['approved', 8]);
});

test('실제 HTML은 승인 확인 전 승차권 버튼을 숨기고 삭제한 안내 문구를 표시하지 않는다', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/public/ticketing.html'), 'utf8');
  const scripts = [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match => match[1]);
  scripts.forEach(script => new vm.Script(script));
  assert.ok(source.includes('src="payment-status.js"'));
  assert.ok(source.includes("document.getElementById('ticketViewBtn').style.display = approved ? 'block' : 'none'"));
  for (const deleted of ['다시 결제하지 않아도 됩니다.', '결제와 예매가 모두 확정되었습니다.', '결제 확인 전에는 승차권이 발급되지 않습니다.', '결제 승인 결과를 확인하고 있습니다.', '완료되면 예매 완료 화면으로 자동 이동합니다.', '결제가 승인되어 예매가 확정되었습니다.', '티켓레일과 함께 편안한 여행 되세요.']) assert.ok(!source.includes(deleted));
});

test('승인 응답에 알림 완료가 있으면 추가 요청 없이 한 번만 알린다', async () => {
  let reads = 0;
  const f = fixture(async () => { reads++; }, createNotificationTracker);
  f.tracker.start(7, { booking_id: 7, status: 'APPROVED', notification_sent: true });
  assert.deepEqual(f.events, [['notification', 7]]);
  assert.equal(f.tasks.size, 0);
  await f.advance(20000);
  assert.equal(reads, 0);
});

test('승인 후 알림 미완료와 통신 오류는 조용히 재조회하고 실제 완료만 알린다', async () => {
  let reads = 0;
  const f = fixture(async id => {
    reads++;
    if (reads === 1) throw new Error('offline');
    return { booking_id: id, status: 'APPROVED', notification_sent: reads >= 3 };
  }, createNotificationTracker);
  f.tracker.start(7, { booking_id: 7, status: 'APPROVED', notification_sent: false });
  await f.advance(6000);
  assert.deepEqual(f.events, []);
  await f.advance(3000);
  assert.deepEqual(f.events, [['notification', 7]]);
  assert.equal(f.tasks.size, 0);
});

test('다른 예약, 비승인, 문자열 true는 알림 완료 근거가 아니다', async () => {
  const replies = [
    { booking_id: 8, status: 'APPROVED', notification_sent: true },
    { booking_id: 7, status: 'FAILED', notification_sent: true },
    { booking_id: 7, status: 'APPROVED', notification_sent: 'true' },
  ];
  const f = fixture(async () => replies.shift(), createNotificationTracker);
  f.tracker.start(7);
  await f.advance(9000);
  assert.deepEqual(f.events, []);
  f.tracker.stop();
  assert.equal(f.tasks.size, 0);
});

test('알림 요청이 멈추어도 요청을 중첩하지 않고 제한 시간 후 조용히 중단한다', async () => {
  let reads = 0;
  const f = fixture(() => { reads++; return new Promise(() => {}); }, createNotificationTracker, { maxWaitMs: 20000 });
  f.tracker.start(7);
  await f.advance(7999);
  assert.equal(reads, 1);
  await f.advance(20000);
  assert.deepEqual(f.events, []);
  assert.equal(f.tasks.size, 0);
});

test('이전 예약의 늦은 알림 완료 응답과 중단 후 응답을 무시한다', async () => {
  const pending = [];
  const f = fixture((id, signal) => new Promise(resolve => pending.push({ id, signal, resolve })), createNotificationTracker);
  f.tracker.start(7);
  await f.advance(3000);
  f.tracker.start(8);
  assert.equal(pending[0].signal.aborted, true);
  pending[0].resolve({ booking_id: 7, status: 'APPROVED', notification_sent: true });
  await flush();
  assert.deepEqual(f.events, []);
  await f.advance(3000);
  f.tracker.stop();
  pending[1].resolve({ booking_id: 8, status: 'APPROVED', notification_sent: true });
  await flush();
  assert.deepEqual(f.events, []);
  assert.equal(f.tasks.size, 0);
});
