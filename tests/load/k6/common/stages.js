import {
  durationEnv,
  durationToSeconds,
  integerEnv,
} from '../config/environments.js';

export function buildStagedLoadPlan() {
  const warmupVus = integerEnv('WARMUP_VUS', 10);
  const normalVus = integerEnv('NORMAL_VUS', 50);
  const peakVus = integerEnv('PEAK_VUS', 200);
  const spikeVus = integerEnv('SPIKE_VUS', 500);
  const recoveryVus = integerEnv('RECOVERY_VUS', 20);

  if (spikeVus > 500) {
    throw new Error('5차 기획서 기준 SPIKE_VUS는 최대 500입니다.');
  }

  const phases = [
    { name: 'warmup_ramp', duration: durationEnv('WARMUP_RAMP_DURATION', '1m'), target: warmupVus },
    { name: 'warmup_hold', duration: durationEnv('WARMUP_HOLD_DURATION', '3m'), target: warmupVus },
    { name: 'normal_ramp', duration: durationEnv('NORMAL_RAMP_DURATION', '2m'), target: normalVus },
    { name: 'normal_hold', duration: durationEnv('NORMAL_HOLD_DURATION', '5m'), target: normalVus },
    { name: 'peak_ramp', duration: durationEnv('PEAK_RAMP_DURATION', '3m'), target: peakVus },
    { name: 'peak_hold', duration: durationEnv('PEAK_HOLD_DURATION', '10m'), target: peakVus },
    { name: 'spike_ramp', duration: durationEnv('SPIKE_RAMP_DURATION', '30s'), target: spikeVus },
    { name: 'spike_hold', duration: durationEnv('SPIKE_HOLD_DURATION', '2m'), target: spikeVus },
    { name: 'recovery_ramp', duration: durationEnv('RECOVERY_RAMP_DURATION', '1m'), target: recoveryVus },
    { name: 'recovery_hold', duration: durationEnv('RECOVERY_HOLD_DURATION', '7m'), target: recoveryVus },
    { name: 'stop', duration: durationEnv('STOP_DURATION', '30s'), target: 0 },
  ];

  let elapsed = 0;
  const timeline = phases.map((phase) => {
    const start = elapsed;
    elapsed += durationToSeconds(phase.duration);
    return { ...phase, start, end: elapsed };
  });

  return {
    stages: phases.map(({ duration, target }) => ({ duration, target })),
    timeline,
  };
}

export function phaseAt(elapsedMilliseconds, timeline) {
  const elapsedSeconds = elapsedMilliseconds / 1000;
  const phase = timeline.find(({ start, end }) => elapsedSeconds >= start && elapsedSeconds < end);
  return phase ? phase.name : 'finished';
}
