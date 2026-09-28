import exec from 'k6/execution';
import { Counter, Trend, Gauge } from 'k6/metrics';

const names = ['requests', 'responses', '2xx', 'other_4xx', '409', '429', '5xx', 'other_http', 'network'];
const counters = Object.fromEntries(names.map(n => [n, new Counter(`client_${n}`)]));
const duration = new Trend('client_duration_ms', true);
let setupSamples = 0;
const scenarioStart = new Gauge('watch_scenario_start_ms');
let markedStart = false;
const sampleLimit = Number(__ENV.SAMPLE_ITERATIONS || '1');
if (!Number.isInteger(sampleLimit) || sampleLimit < 0) throw new Error('SAMPLE_ITERATIONS는 0 이상의 정수여야 합니다.');

export function started(tags) {
  if (!markedStart && tags.phase !== 'setup') {
    scenarioStart.add(exec.scenario.startTime);
    markedStart = true;
  }
  counters.requests.add(1, tags);
  for (const n of names.slice(1)) counters[n].add(0, tags);
}

export function completed(res, method, path, tags) {
  const s = res.status;
  const category = s === 0 ? 'network' : s === 409 ? '409' : s === 429 ? '429'
    : s >= 200 && s < 300 ? '2xx' : s >= 400 && s < 500 ? 'other_4xx'
    : s >= 500 && s < 600 ? '5xx' : 'other_http';
  counters.responses.add(1, tags);
  counters[category].add(1, tags);
  duration.add(res.timings.duration, tags);
  const sample = tags.phase === 'setup' ? setupSamples++ < sampleLimit
    : exec.scenario.iterationInTest < sampleLimit;
  if (sample) {
    let body = {};
    try { body = res.json(); } catch (_) { /* Non-JSON response: HTTP status remains evidence. */ }
    const selected = {};
    for (const key of ['status', 'booking_id', 'position']) {
      if (body && ['string', 'number', 'boolean'].includes(typeof body[key])) selected[key] = body[key];
    }
    if (Array.isArray(body)) selected.item_count = body.length;
    else if (Array.isArray(body && body.seats)) selected.seat_count = body.seats.length;
    console.log(JSON.stringify({type: 'request_sample', at: new Date().toISOString(),
      method, path, phase: tags.phase || 'main', http_status: s,
      duration_ms: res.timings.duration, response: selected}));
  }
}

export function handleSummary(data) {
  const path = __ENV.SUMMARY_PATH || 'k6-summary.json';
  return {[path]: JSON.stringify(data, null, 2), stdout: 'k6 집계 완료. report.md를 확인하세요.\n'};
}
