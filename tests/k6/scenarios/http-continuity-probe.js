import http from 'k6/http';
import { check } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { expectedCallback, buildHeaders } from '../common/api.js';
import { arrivalScenario } from '../common/arrival.js';
import { csvStatusCodes, durationEnv, durationToSeconds, integerEnv,
  optionalEnv, parseOptionalJsonEnv, requiredEnv } from '../config/environments.js';

const targetUrl = requiredEnv('TARGET_URL');
const testId = optionalEnv('TEST_ID', 'http-continuity');
const timeout = durationEnv('REQUEST_TIMEOUT', optionalEnv('TIMEOUT', '2s'));
const rate = integerEnv('RATE', 1);
const duration = durationEnv('DURATION', '10m');
const codes = csvStatusCodes('EXPECTED_STATUS_CODES', csvStatusCodes('EXPECTED_STATUS', [200]));
const responseCallback = expectedCallback(codes);
const headers = buildHeaders(optionalEnv('AUTH_TOKEN'), parseOptionalJsonEnv('REQUEST_HEADERS_JSON', {}));
const requests = new Counter('probe_requests');
const failed = new Rate('probe_failed');
const latency = new Trend('probe_latency', true);

export const options = {
  discardResponseBodies: true,
  scenarios: { continuity_probe: arrivalScenario(rate, duration, durationToSeconds(timeout)) },
  thresholds: { dropped_iterations: ['count==0'] },
  tags: { test_id: testId, run_id: optionalEnv('RUN_ID', String(Date.now())) },
};

export default function () {
  const response = http.get(targetUrl, { timeout, headers, redirects: 0, responseCallback,
    tags: { name: 'continuity_target', api: 'continuity_target' } });
  const success = codes.includes(response.status);
  const tags = { api: 'continuity_target', status: String(response.status) };
  requests.add(1, tags);
  failed.add(!success, tags);
  latency.add(response.timings.duration, tags);
  check(response, { 'probe expected status': () => success }, tags);
}
