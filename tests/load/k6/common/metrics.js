import { Counter } from 'k6/metrics';

export const responses2xx = new Counter('responses_2xx');
export const responses4xx = new Counter('responses_4xx');
export const responses5xx = new Counter('responses_5xx');
export const networkFailures = new Counter('network_failures');
export const businessConflicts = new Counter('business_conflicts');
export const unexpectedStatuses = new Counter('unexpected_statuses');
