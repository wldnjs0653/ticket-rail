import { sleep } from 'k6';
import exec from 'k6/execution';
import { sendApiRequest } from '../common/api.js';
import { classifyResponse } from '../common/checks.js';
import { buildQueueConfig, joinQueue, waitForAdmission } from '../common/queue.js';
import { buildStagedLoadPlan, phaseAt } from '../common/stages.js';
import { failoverScenario } from '../common/arrival.js';
import { beginFlow } from '../common/flow.js';
import {
  durationEnv,
  optionalEnv,
  parseOptionalJsonEnv,
  requiredEnv,
  durationToSeconds, numberEnv,
} from '../config/environments.js';

const baseUrl = requiredEnv('BASE_URL');
const eventId = requiredEnv('EVENT_ID');
const runId = optionalEnv('RUN_ID', `${Date.now()}`);
const userPrefix = optionalEnv('QUEUE_USER_PREFIX', 'k6-queue-user');
const afterAdmissionPath = optionalEnv('AFTER_ADMISSION_PATH', '');
const thinkTime = numberEnv('THINK_TIME_SECONDS', 1, true);
const commonHeaders = parseOptionalJsonEnv('REQUEST_HEADERS_JSON', {});
const testMode = optionalEnv('TEST_MODE', 'standard');
const queueConfig = buildQueueConfig();
const gracefulStop = durationEnv('GRACEFUL_STOP', String(Math.ceil(queueConfig.maxWaitSeconds
  + durationToSeconds(queueConfig.requestTimeout) * (afterAdmissionPath ? 2 : 1)) + 2) + 's');
const stagedPlan = testMode === 'standard' ? buildStagedLoadPlan() : null;

if (!Number.isFinite(thinkTime) || thinkTime < 0) {
  throw new Error('THINK_TIME_SECONDS는 0 이상의 숫자여야 합니다.');
}
if (!['standard', 'failover'].includes(testMode)) {
  throw new Error('TEST_MODE는 standard 또는 failover여야 합니다.');
}

export const options = {
  scenarios: testMode === 'failover'
    ? {
      redis_failover: failoverScenario(queueConfig.maxWaitSeconds
        + durationToSeconds(queueConfig.requestTimeout) * (afterAdmissionPath ? 2 : 1)),
    }
    : {
      queue_load: {
        executor: 'ramping-vus',
        startVUs: 0,
        stages: stagedPlan.stages,
        gracefulRampDown: gracefulStop,
        gracefulStop,
      },
    },
  thresholds: testMode === 'failover' ? { dropped_iterations: ['count==0'] } : {},
  tags: { test: 'queue_load', run_id: runId },
};

export default function () {
  const phase = testMode === 'failover'
    ? 'failover'
    : phaseAt(exec.instance.currentTestRunDuration, stagedPlan.timeline);
  const iteration = exec.scenario.iterationInTest;
  const userId = `${userPrefix}-${runId}-${exec.vu.idInTest}-${iteration}`;
  const tags = { test: 'queue_load', phase };
  const finish = beginFlow(tags);
  let success = false;
  let step = 'queue_join';
  try {
    const joined = joinQueue({
      baseUrl,
      eventId,
      userId,
      idempotencyKey: `k6-queue-${runId}-${exec.vu.idInTest}-${iteration}`,
      commonHeaders,
      config: queueConfig,
      tags,
    });

    if (joined) {
      step = 'auth_verify';
      const admission = waitForAdmission({
        baseUrl,
        eventId,
        token: joined.token,
        commonHeaders,
        config: queueConfig,
        tags,
      });

      success = admission.admitted;
      if (admission.admitted && afterAdmissionPath) {
        step = 'after_admission';
        const response = sendApiRequest({
          baseUrl,
          path: afterAdmissionPath.replace('{eventId}', eventId),
          method: 'GET',
          headers: commonHeaders,
          tags: { ...tags, api: 'after_admission' },
          successCodes: [200], timeout: queueConfig.requestTimeout,
        });
        success = classifyResponse(response, [200], [], { ...tags, api: step }).isSuccess;
      }
    }
  } finally {
    finish(success, step);
  }
  if (testMode === 'standard') sleep(thinkTime);
}
