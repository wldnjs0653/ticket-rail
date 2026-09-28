import { Counter, Rate, Trend } from 'k6/metrics';

const started = new Counter('flow_started');
const completed = new Counter('flow_completed');
const successes = new Counter('flow_successes');
const conflicts = new Counter('flow_conflicts');
const failed = new Rate('flow_failed');
const duration = new Trend('flow_duration_ms', true);

// VU 강제 중단 시 completed가 남지 않을 수 있으므로 started-completed도 함께 확인한다.
export function beginFlow(tags) {
  started.add(1, tags);
  const startedAt = Date.now();
  let finished = false;
  return (success, failedStep = 'none', conflict = false) => {
    if (finished) throw new Error('한 flow를 두 번 종료할 수 없습니다.');
    finished = true;
    const resultTags = { ...tags, failed_step: success ? 'none' : failedStep,
      outcome: success ? 'success' : conflict ? 'conflict' : 'error' };
    completed.add(1, resultTags);
    successes.add(success ? 1 : 0, tags);
    conflicts.add(conflict ? 1 : 0, tags);
    failed.add(!success, resultTags);
    duration.add(Date.now() - startedAt, resultTags);
  };
}
