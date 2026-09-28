export { handleSummary } from '../common/results.js';
import { sleep } from 'k6';
import exec from 'k6/execution';
import { classifyResponse } from '../common/checks.js';
import { configureExpectedStatuses, sendApiRequest } from '../common/api.js';
import { buildStagedLoadPlan, phaseAt } from '../common/stages.js';
import {
  csvStatusCodes,
  durationEnv,
  integerEnv,
  optionalEnv,
  parseOptionalJsonEnv,
  parseJsonEnv,
  requiredEnv,
} from '../config/environments.js';

const baseUrl = requiredEnv('BASE_URL');
const targetPath = requiredEnv('TARGET_PATH');
const method = optionalEnv('HTTP_METHOD', 'GET').toUpperCase();
const body = ['GET', 'HEAD'].includes(method) ? null : parseJsonEnv('REQUEST_BODY_JSON');
const token = optionalEnv('AUTH_TOKEN');
const requestHeaders = parseOptionalJsonEnv('REQUEST_HEADERS_JSON', {});
const idempotencyKeyPrefix = optionalEnv('IDEMPOTENCY_KEY_PREFIX');
const successCodes = csvStatusCodes('EXPECTED_STATUS_CODES');
const thinkTime = Number.parseFloat(optionalEnv('THINK_TIME_SECONDS', '1'));
const testMode = optionalEnv('TEST_MODE', 'standard');
const gracefulStop = durationEnv('GRACEFUL_STOP', '30s');

if (!Number.isFinite(thinkTime) || thinkTime < 0) {
  throw new Error('THINK_TIME_SECONDS는 0 이상의 숫자여야 합니다.');
}

if (!['standard', 'failover'].includes(testMode)) {
  throw new Error('TEST_MODE는 standard 또는 failover여야 합니다.');
}

configureExpectedStatuses(successCodes);
const stagedPlan = testMode === 'standard' ? buildStagedLoadPlan() : null;

function buildFailoverScenarios() {
  const failoverVus = integerEnv('FAILOVER_VUS', 10);
  const failoverDuration = durationEnv('FAILOVER_DURATION', '15m');
  return {
    failover: {
      executor: 'constant-vus',
      vus: failoverVus,
      duration: failoverDuration,
      gracefulStop,
    },
  };
}

const phaseThresholds = {};
for (const phase of [...(stagedPlan ? stagedPlan.timeline.map(p => p.name) : ['failover']), 'finished']) {
  phaseThresholds[`client_requests{phase:${phase}}`] = ['count>=0'];
  phaseThresholds[`client_duration_ms{phase:${phase}}`] = ['p(95)>=0'];
}
export const options = {
  thresholds: phaseThresholds,
  scenarios: testMode === 'failover'
    ? buildFailoverScenarios()
    : {
      staged_load: {
        executor: 'ramping-vus',
        startVUs: 0,
        stages: stagedPlan.stages,
        gracefulRampDown: gracefulStop,
      },
    },
};

export default function () {
  const phase = testMode === 'failover'
    ? 'failover'
    : phaseAt(Date.now() - exec.scenario.startTime, stagedPlan.timeline);
  const headers = { ...requestHeaders };
  if (idempotencyKeyPrefix) {
    headers['Idempotency-Key'] = [
      idempotencyKeyPrefix,
      phase,
      exec.vu.idInTest,
      exec.scenario.iterationInTest,
    ].join('-');
  }

  const response = sendApiRequest({
    baseUrl,
    path: targetPath,
    method,
    body,
    token,
    headers,
    tags: { api: 'load_target', phase },
  });

  classifyResponse(response, successCodes);
  sleep(thinkTime);
}
