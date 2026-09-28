import { check } from 'k6';
import { configureExpectedStatuses, sendApiRequest } from '../common/api.js';
import { requiredEnv, optionalEnv } from '../config/environments.js';
export { handleSummary } from '../common/results.js';
configureExpectedStatuses([200]);
export const options = {
  scenarios: {smoke: {executor: 'shared-iterations', vus: 1, iterations: 1, maxDuration: '30s'}},
  thresholds: {http_reqs: ['count==1'], checks: ['rate==1']},
};
export default function () {
  const res = sendApiRequest({baseUrl: requiredEnv('BASE_URL'),
    path: optionalEnv('HEALTH_PATH', '/health/live'), tags: {api: 'health'}, timeout: '15s'});
  let body;
  try { body = res.json(); } catch (_) { body = null; }
  check(res, {'HTTP 200': r => r.status === 200, 'status=ok': () => body && body.status === 'ok'});
}
