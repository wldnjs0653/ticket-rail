#!/usr/bin/env node
// Executes the actual scenario against deterministic k6/HTTP doubles in Node VM.
// Validates branching/evidence, not the real k6 runtime, network, or simultaneous arrival.
const fs = require('fs');
const vm = require('vm');
const mode = process.env.CONCURRENCY_TEST_MODE;
if (!mode) process.exit(78);
if (process.argv.includes('version')) { console.log('mock k6 executing actual JS via Node VM'); process.exit(0); }
const sourcePath = process.argv.at(-1);
const source = fs.readFileSync(sourcePath, 'utf8')
  .replace(/^import .*;\n/gm, '').replace(/export default function/, 'function iteration').replace(/export /g, '')
  + '\nthis.api = {setup, iteration, handleSummary, options};';
const counters = {}; const lines = []; let held = false;
function context(vu, time) {
  const clock = { time };
  const actualDate = Date;
  class FakeDate extends actualDate { static now() { return clock.time; } }
  const sandbox = {
    __ENV: process.env, Date: FakeDate,
    exec: { vu: { idInTest: vu } },
    sleep: seconds => { if (seconds < 0) throw Error('negative sleep'); clock.time += Math.ceil(seconds * 1000); },
    Counter: class { constructor(name) { this.name = name; } add(n) { counters[this.name] = (counters[this.name] || 0) + n; } },
    Trend: class { add() {} },
    check: (value, checks) => Object.values(checks).every(fn => fn(value)),
    console: { log: text => lines.push(text) },
    http: {
      expectedStatuses: (...codes) => codes,
      post: (url, raw, params) => {
        if (!params.headers['Idempotency-Key']) throw Error('missing idempotency key');
        const value = JSON.parse(raw); let status; let payload;
        if (url.endsWith('/queue/join')) { status = 202; payload = { token: 'private-' + value.user_id }; }
        else if (url.endsWith('/auth/verify')) { status = 200; payload = { status: 'admitted' }; }
        else if (url.endsWith('/hold')) {
          if (value.event_id !== '1' || !url.endsWith('/seats/9/hold')) throw Error('wrong seat/event');
          status = !held || mode === 'double-winner' ? 200 : 409; held = true; payload = {};
          clock.time += mode === 'no-overlap' ? 1 : 50;
        } else if (url.endsWith('/bookings')) {
          status = 201; payload = { booking_id: 900 + Number(value.user_id) }; clock.time += 5;
        } else throw Error('unexpected endpoint');
        return { status, timings: { duration: 1 }, json: key => key ? payload[key] : payload };
      },
    },
  };
  vm.createContext(sandbox); vm.runInContext(source, sandbox, { filename: sourcePath });
  return sandbox.api;
}
const setup = context(0, 1789430400000);
if (setup.options.insecureSkipTLSVerify !== false || setup.options.scenarios.same_seat.vus !== 5) throw Error('bad options');
const data = setup.setup();
for (let vu = 1; vu <= 5; vu++) {
  const offset = mode === 'no-overlap' ? vu * 10 : vu;
  context(vu, data.targetMs + offset).iteration(data);
}
const expected = counters.hold_successes === 1 && counters.hold_conflicts === 4 && counters.booking_successes === 1;
const outputs = setup.handleSummary({ metrics: counters, MOCK_DATA: true });
fs.writeFileSync('summary.json', outputs['summary.json']);
const log = process.argv.find(x => x.startsWith('file='));
fs.writeFileSync(log.slice(5), lines.join('\n') + '\n');
if (lines.some(x => x.includes('private-'))) throw Error('token exposed');
fs.writeFileSync('points.json', JSON.stringify({ MOCK_DATA: true }) + '\n');
console.log(outputs.stdout);
process.exit(expected ? 0 : 99);
