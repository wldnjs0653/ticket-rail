import { sleep } from 'k6';
import exec from 'k6/execution';
import { classifyResponse } from '../common/checks.js';
import { sendApiRequest } from '../common/api.js';
import { buildStagedLoadPlan, phaseAt } from '../common/stages.js';
import { failoverScenario } from '../common/arrival.js';
import {
  csvStatusCodes,
  durationEnv,
  optionalEnv,
  parseOptionalJsonEnv,
  parseJsonEnv,
  requiredEnv,
  durationToSeconds, numberEnv,
} from '../config/environments.js';

const baseUrl = requiredEnv('BASE_URL');
const targetPath = requiredEnv('TARGET_PATH');
const method = optionalEnv('HTTP_METHOD', 'GET').toUpperCase();
const body = ['GET', 'HEAD'].includes(method) ? null : parseJsonEnv('REQUEST_BODY_JSON');
const token = optionalEnv('AUTH_TOKEN');
const requestHeaders = parseOptionalJsonEnv('REQUEST_HEADERS_JSON', {});
const idempotencyKeyPrefix = optionalEnv('IDEMPOTENCY_KEY_PREFIX');
const successCodes = csvStatusCodes('EXPECTED_STATUS_CODES', [200]);
const thinkTime = numberEnv('THINK_TIME_SECONDS', 1, true);
const testMode = optionalEnv('TEST_MODE', 'standard');
const gracefulStop = durationEnv('GRACEFUL_STOP', '30s');
const timeout = durationEnv('REQUEST_TIMEOUT', testMode === 'failover' ? '2s' : '30s');

if (!Number.isFinite(thinkTime) || thinkTime < 0) {
  throw new Error('THINK_TIME_SECONDS는 0 이상의 숫자여야 합니다.');
}

if (!['standard', 'failover'].includes(testMode)) {
  throw new Error('TEST_MODE는 standard 또는 failover여야 합니다.');
}

const stagedPlan = testMode === 'standard' ? buildStagedLoadPlan() : null;

function buildFailoverScenarios() {
  return {
    failover: failoverScenario(durationToSeconds(timeout)),
  };
}

export const options = {
  scenarios: testMode === 'failover'
    ? buildFailoverScenarios()
    : {
      staged_load: {
        executor: 'ramping-vus',
        startVUs: 0,
        stages: stagedPlan.stages,
        gracefulRampDown: gracefulStop,
        gracefulStop,
      },
    },
  thresholds: testMode === 'failover' ? { dropped_iterations: ['count==0'] } : {},
  tags: { test: 'load', run_id: optionalEnv('RUN_ID', `${Date.now()}`) },
};

export default function () {
  const phase = testMode === 'failover'
    ? 'failover'
    : phaseAt(exec.instance.currentTestRunDuration, stagedPlan.timeline);
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
    timeout, successCodes,
  });

  classifyResponse(response, successCodes, [], { api: 'load_target', phase });
  if (testMode === 'standard') sleep(thinkTime);
}
