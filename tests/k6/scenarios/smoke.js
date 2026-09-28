import { check } from 'k6';
import { classifyResponse } from '../common/checks.js';
import { sendApiRequest } from '../common/api.js';
import { csvStatusCodes, optionalEnv, parseOptionalJsonEnv, requiredEnv } from '../config/environments.js';

const baseUrl = requiredEnv('BASE_URL');
const healthPath = optionalEnv('HEALTH_PATH', '/healthz');
const successCodes = csvStatusCodes('EXPECTED_STATUS_CODES', [200]);
const headers = parseOptionalJsonEnv('REQUEST_HEADERS_JSON', {});


export const options = {
  vus: 1,
  iterations: 1,
  thresholds: { checks: ['rate==1'] },
  tags: { test: 'smoke', run_id: optionalEnv('RUN_ID', `${Date.now()}`) },
};

export default function () {
  const response = sendApiRequest({ baseUrl, path: healthPath, method: 'GET', headers,
    successCodes, tags: { api: 'health' } });
  classifyResponse(response, successCodes);
  check(response, {
    'health body is ok': (res) => {
      try {
        return res.json('status') === 'ok';
      } catch (_) {
        return false;
      }
    },
  });

  console.log(`Smoke response: status=${response.status}, body=${response.body}`);
}
