const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  validateServiceDate, displayTrainTitle, planServiceDate, createDailyCatalog,
} = require('../src/services/dailyTrainCatalog');

test('실제 달력 날짜만 허용하고 윤년/잘못된 날짜를 구분한다', () => {
  for (const date of ['2026-10-13', '2026-10-17', '2028-02-29', '2027-01-01']) {
    assert.equal(validateServiceDate(date), date);
  }
  for (const date of ['', null, ['2026-10-17'], '2026-02-29', '2026-04-31', '2026-13-01', '2026-10-17;DELETE']) {
    assert.throws(() => validateServiceDate(date), /invalid_service_date/);
  }
});

test('모든 일자는 같은 시간표를 가지며 한국 출발일과 실제 도착 시간을 유지한다', () => {
  const first = planServiceDate('2026-10-17');
  const second = planServiceDate('2026-10-18');
  assert.equal(first.length, 44);
  assert.ok(first.some(train => train.title === 'KTX 101 서울-부산'));
  assert.ok(first.some(train => train.title.endsWith('부산-서울')));
  first.forEach((train, index) => {
    assert.equal(displayTrainTitle(train.tagged_title), train.title);
    assert.equal(second[index].title, train.title);
    assert.notEqual(second[index].tagged_title, train.tagged_title);
    assert.equal(new Date(second[index].opens_at) - new Date(train.opens_at), 86400000);
    assert.equal(new Date(second[index].closes_at) - new Date(train.closes_at), 86400000);
    assert.equal(train.price, second[index].price);
    assert.equal(train.seats, 200);
    const day = new Date(new Date(train.opens_at).getTime() + 9 * 3600000).toISOString().slice(0, 10);
    assert.equal(day, '2026-10-17');
  });
});

function fakePool({ failOnce = false } = {}) {
  const state = { connections: 0, releases: 0, calls: [], failed: false };
  return {
    state,
    async connect() {
      state.connections++;
      return {
        async query(sql, values) {
          state.calls.push({ sql, values });
          if (sql.includes('INSERT INTO ticket_event') && failOnce && !state.failed) {
            state.failed = true;
            throw new Error('seed_failed');
          }
          if (sql.includes('SELECT DISTINCT ON')) {
            return { rows: planServiceDate('2026-10-17').map((train, index) => ({ id: index + 1, price: train.price, seats: 200 })) };
          }
          return { rows: [] };
        },
        release() { state.releases++; },
      };
    },
  };
}

test('같은 일자의 동시 조회를 합치고 완료 결과를 재사용한다', async () => {
  const pool = fakePool();
  const ensure = createDailyCatalog(pool);
  const results = await Promise.all(Array.from({ length: 20 }, () => ensure('2026-10-17')));
  assert.equal(pool.state.connections, 1);
  assert.equal(pool.state.releases, 1);
  assert.deepEqual(results[0], results[19]);
  assert.equal(results[0].length, 44);
  await ensure('2026-10-17');
  assert.equal(pool.state.connections, 1);
  await ensure('2026-10-18');
  assert.equal(pool.state.connections, 2);
  assert.equal(pool.state.calls.filter(call => call.sql.includes('pg_advisory_xact_lock')).length, 2);
});

test('생성 실패 시 롤백하고 실패한 캐시를 제거하여 재시도할 수 있다', async () => {
  const pool = fakePool({ failOnce: true });
  const ensure = createDailyCatalog(pool);
  await assert.rejects(ensure('2026-10-17'), /seed_failed/);
  assert.equal(pool.state.releases, 1);
  assert.ok(pool.state.calls.some(call => call.sql === 'ROLLBACK'));
  await ensure('2026-10-17');
  assert.equal(pool.state.connections, 2);
  assert.equal(pool.state.releases, 2);
  assert.ok(pool.state.calls.some(call => call.sql === 'COMMIT'));
});

test('잘못된 날짜는 DB 연결 전에 거부한다', async () => {
  const pool = fakePool();
  await assert.rejects(createDailyCatalog(pool)('2026-02-30'), /invalid_service_date/);
  assert.equal(pool.state.connections, 0);
});

test('날짜별 조회 API는 정상 일자, 잘못된 일자, 기존 조회를 구분한다', async () => {
  const express = require('express');
  const pool = fakePool();
  const reads = [];
  pool.readQuery = async (sql, values) => {
    reads.push({ sql, values });
    return { rows: [{ id: '1', title: 'KTX 101 [2026-10-17] 서울-부산', opens_at: '2026-10-16T21:00:00Z' }] };
  };
  const module = { exports: {} };
  const filename = path.join(__dirname, '../src/routes/event.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, console,
    require(name) {
      if (name === 'express') return express;
      if (name === '../clients/pgClient') return pool;
      return require('../src/services/dailyTrainCatalog');
    },
  }, { filename });
  const app = express();
  app.use('/events', module.exports);
  const server = app.listen(0, '127.0.0.1');
  try {
    if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/events`;
    assert.equal((await fetch(`${base}?date=2026-02-30`)).status, 400);
    assert.equal((await fetch(`${base}?date=2026-10-17&date=2026-10-18`)).status, 400);
    assert.equal(pool.state.connections, 0);
    const response = await fetch(`${base}?date=2026-10-17`);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.service_date, '2026-10-17');
    assert.equal(data.events[0].title, 'KTX 101 서울-부산');
    assert.match(reads[0].sql, /e.id = ANY\(\$1::bigint\[\]\)/);
    assert.equal(reads[0].values[0].length, 44);
    assert.equal((await fetch(base)).status, 200);
    assert.doesNotMatch(reads[1].sql, /WHERE e.id/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('예매 화면의 inline JavaScript 문법이 유효하다', () => {
  for (const name of ['ticketing.html', 'login.html']) {
    const html = fs.readFileSync(path.join(__dirname, '../src/public', name), 'utf8');
    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (!/\bsrc\s*=/.test(match[1])) new vm.Script(match[2], { filename: name });
    }
  }
});
