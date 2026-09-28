import { check } from 'k6';
import {
  businessConflicts,
  networkFailures,
  responses2xx,
  responses4xx,
  responses5xx,
  unexpectedStatuses,
} from './metrics.js';

export function classifyResponse(response, successCodes = [], conflictCodes = []) {
  const status = response.status;
  const is2xx = status >= 200 && status < 300;
  const is4xx = status >= 400 && status < 500;
  const is5xx = status >= 500 && status < 600;
  const isSuccess = is2xx || successCodes.includes(status);
  const isBusinessConflict = conflictCodes.includes(status);

  if (status === 0) networkFailures.add(1);
  if (is2xx) responses2xx.add(1);
  if (is4xx) responses4xx.add(1);
  if (is5xx) responses5xx.add(1);
  if (isBusinessConflict) businessConflicts.add(1);
  if (!isSuccess && !isBusinessConflict) unexpectedStatuses.add(1);

  check(response, {
    'network connection succeeded': (res) => res.status !== 0,
    'status is expected': () => isSuccess || isBusinessConflict,
  });

  return { isSuccess, isBusinessConflict };
}
