export { handleSummary } from '../common/results.js';
// Runbook v2 Appendix A; integrated with the reviewed v1.4 common/config modules.
// Observe the current version. Arrival rates are offered load, not admission limits.
import exec from 'k6/execution';
import { configureExpectedStatuses } from '../common/api.js';
import { buildQueueConfig, joinQueue, waitForAdmission, queueWaitingResponses, queueAdmissions, queueSoldOut } from '../common/queue.js';
import { buildReadConfig, readWhileAdmitted, readFailures, readSessions, readSessionsCompleted, readRequests } from '../common/admitted-read.js';
import { durationEnv, durationToSeconds, integerEnv, optionalEnv, parseOptionalJsonEnv, requiredEnv } from '../config/environments.js';

const baseUrl = requiredEnv('BASE_URL');
const eventId = requiredEnv('EVENT_ID');
const runId = optionalEnv('RUN_ID', `${Date.now()}`);
const userPrefix = optionalEnv('QUEUE_USER_PREFIX', 'k6-backlog-user');
const commonHeaders = parseOptionalJsonEnv('REQUEST_HEADERS_JSON', {});
const queueConfig = buildQueueConfig();
const readConfig = buildReadConfig();
const baselineRate = integerEnv('BASELINE_RATE', 3);
const boundaryRate = integerEnv('BOUNDARY_RATE', 5);
const backlogRate = integerEnv('BACKLOG_RATE', 10);
const spikeRate = integerEnv('QUEUE_SPIKE_RATE', 20);
const preAllocatedVUs = integerEnv('PRE_ALLOCATED_VUS', 100);
const maxVUs = integerEnv('MAX_VUS', 500);
configureExpectedStatuses([200, 202, ...queueConfig.waitingCodes], [...queueConfig.expiredCodes, ...queueConfig.soldOutCodes]);

const queueStages = [
        { duration: durationEnv('BASELINE_DURATION', '2m'), target: baselineRate },
        { duration: durationEnv('BOUNDARY_RAMP_DURATION', '10s'), target: boundaryRate },
        { duration: durationEnv('BOUNDARY_DURATION', '2m'), target: boundaryRate },
        { duration: durationEnv('BACKLOG_RAMP_DURATION', '10s'), target: backlogRate },
        { duration: durationEnv('BACKLOG_DURATION', '1m'), target: backlogRate },
        { duration: durationEnv('QUEUE_SPIKE_RAMP_DURATION', '5s'), target: spikeRate },
        { duration: durationEnv('QUEUE_SPIKE_DURATION', '15s'), target: spikeRate },
        { duration: durationEnv('QUEUE_STOP_RAMP_DURATION', '1s'), target: 0 },
        { duration: durationEnv('QUEUE_RECOVERY_DURATION', '10m'), target: 0 },
      ];

export const options = {
  scenarios: {
    queue_backlog: {
      executor: 'ramping-arrival-rate', startRate: baselineRate, timeUnit: '1s',
      preAllocatedVUs, maxVUs,
      stages: queueStages,
      gracefulStop: durationEnv('QUEUE_GRACEFUL_STOP', '11m'),
    },
  },
  thresholds: {
    ...(readConfig.enabled ? { queue_read_failures: ['count==0'] } : {}),
    dropped_iterations: ['count==0'], queue_join_failures: ['count==0'],
    queue_admission_failures: ['count==0'], network_failures: ['count==0'],
    unexpected_statuses: ['count==0'],
  },
};
export function setup() {
  console.log(JSON.stringify({type: 'queue_plan', duration_seconds:
    queueStages.reduce((n, stage) => n + durationToSeconds(stage.duration), 0)}));
}
export default function () {
  const iteration = exec.scenario.iterationInTest;
  const userId = `${userPrefix}-${runId}-${iteration}`;
  const tags = { test: 'queue_backlog', run_id: runId };
  // Emit a real zero once for the two observational counters, even when no one waits.
  // If no iteration runs, these counters remain absent and measurement is incomplete.
  if (iteration === 0) {
    queueWaitingResponses.add(0, tags);
    queueAdmissions.add(0, tags);
    if (queueConfig.soldOutCodes.length) queueSoldOut.add(0, tags);
    if (readConfig.enabled) {
      readFailures.add(0, tags);
      readSessions.add(0, tags);
      readSessionsCompleted.add(0, tags);
      readRequests.add(0, tags);
    }
  }
  const joined = joinQueue({ baseUrl, eventId, userId,
    idempotencyKey: `k6-queue-${runId}-${iteration}`, commonHeaders, config: queueConfig, tags });
  if (!joined || joined.terminal) return;
  const admission = waitForAdmission({ baseUrl, eventId, token: joined.token, commonHeaders, config: queueConfig, tags });
  readWhileAdmitted({ baseUrl, eventId, admission, commonHeaders, config: readConfig, tags });
}
