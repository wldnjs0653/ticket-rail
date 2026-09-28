import http from 'k6/http';
import { started, completed } from './results.js';
import { joinUrl, optionalEnv } from '../config/environments.js';

export function configureExpectedStatuses(successCodes = [], conflictCodes = []) {
  const rules = [{ min: 200, max: 299 }, ...successCodes, ...conflictCodes];
  http.setResponseCallback(http.expectedStatuses(...rules));
}

function hasHeader(headers, targetName) {
  const normalizedTarget = targetName.toLowerCase();
  return Object.keys(headers).some((name) => name.toLowerCase() === normalizedTarget);
}

export function buildHeaders(token = optionalEnv('AUTH_TOKEN'), requestHeaders = {}) {
  if (!requestHeaders || typeof requestHeaders !== 'object' || Array.isArray(requestHeaders)) {
    throw new Error('요청 Header는 JSON 객체여야 합니다.');
  }

  const headers = { Accept: 'application/json', ...requestHeaders };
  if (token && !hasHeader(headers, 'Authorization')) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export function sendApiRequest({
  baseUrl,
  path,
  method = 'GET',
  body = null,
  token = optionalEnv('AUTH_TOKEN'),
  headers: requestHeaders = {},
  tags = {},
  timeout = optionalEnv('REQUEST_TIMEOUT', '30s'),
}) {
  const upperMethod = method.toUpperCase();
  const headers = buildHeaders(token, requestHeaders);
  let payload = null;

  if (body !== null && !['GET', 'HEAD'].includes(upperMethod)) {
    if (!hasHeader(headers, 'Content-Type')) {
      headers['Content-Type'] = 'application/json';
    }
    payload = typeof body === 'string' ? body : JSON.stringify(body);
  }

  const metricTags = { ...tags, name: tags.api || path };
  started(metricTags);
  const response = http.request(upperMethod, joinUrl(baseUrl, path), payload, {
    headers,
    tags: metricTags,
    timeout,
    redirects: 0,
  });
  completed(response, upperMethod, path, metricTags);
  return response;
}
