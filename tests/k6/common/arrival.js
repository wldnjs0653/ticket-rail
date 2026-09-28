import { durationEnv, durationToSeconds, integerEnv } from '../config/environments.js';

// 전체 iteration의 시간 예산으로 산정한다. 실측 dropped_iterations 확인은 별도 필요.
export function arrivalScenario(rate, duration, budgetSeconds) {
  const suggested = Math.max(2, Math.ceil(rate * budgetSeconds * 1.5));
  // 긴 대기 상한만으로 수백~수천 VU를 자동 할당하지 않는다.
  // 100은 기본 할당 상한이며, 목표 rate 유지에 충분하다는 의미는 아니다.
  const preAllocatedVUs = integerEnv('PRE_ALLOCATED_VUS', Math.min(suggested, 100));
  const maxVUs = integerEnv('MAX_VUS', preAllocatedVUs);
  const gracefulStop = durationEnv('GRACEFUL_STOP', `${Math.ceil(budgetSeconds) + 2}s`);
  if (maxVUs < preAllocatedVUs) throw new Error('MAX_VUS는 PRE_ALLOCATED_VUS 이상이어야 합니다.');
  if (durationToSeconds(gracefulStop) < budgetSeconds) {
    throw new Error(`GRACEFUL_STOP은 iteration 시간 예산 ${budgetSeconds}초 이상이어야 합니다.`);
  }
  return { executor: 'constant-arrival-rate', rate, timeUnit: '1s', duration,
    preAllocatedVUs, maxVUs, gracefulStop };
}

export function failoverScenario(budgetSeconds) {
  if (__ENV.FAILOVER_VUS) {
    throw new Error('FAILOVER_VUS 대신 FAILOVER_RATE(iteration/s), PRE_ALLOCATED_VUS를 사용하세요.');
  }
  return arrivalScenario(integerEnv('FAILOVER_RATE', 1),
    durationEnv('FAILOVER_DURATION', '10m'), budgetSeconds);
}
