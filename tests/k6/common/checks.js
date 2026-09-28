import { check } from 'k6';
import {
  businessConflicts,
  networkFailures,
  responses2xx,
  responses4xx,
  responses5xx,
  unexpectedStatuses,
} from './metrics.js';

export function classifyResponse(response, successCodes = [], conflictCodes = [], tags = {}) {
  const status = response.status;
  const is2xx = status >= 200 && status < 300;
  const is4xx = status >= 400 && status < 500;
  const is5xx = status >= 500 && status < 600;
  const isSuccess = successCodes.length ? successCodes.includes(status) : is2xx;
  const isBusinessConflict = !isSuccess && conflictCodes.includes(status);

  networkFailures.add(status === 0 ? 1 : 0, tags);
  if (is2xx) responses2xx.add(1, tags);
  if (is4xx) responses4xx.add(1, tags);
  if (is5xx) responses5xx.add(1, tags);
  if (isBusinessConflict) businessConflicts.add(1, tags);
  unexpectedStatuses.add(!isSuccess && !isBusinessConflict ? 1 : 0, tags);

  check(response, {
    'network connection succeeded': (res) => res.status !== 0,
    'status is expected': () => isSuccess || isBusinessConflict,
  }, tags);

  return { isSuccess, isBusinessConflict };
}
