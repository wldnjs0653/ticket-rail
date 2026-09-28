import http from 'k6/http';
import { durationEnv, joinUrl, optionalEnv } from '../config/environments.js';

const callbacks = {};

export function expectedCallback(successCodes = [], conflictCodes = []) {
  const key = JSON.stringify([successCodes, conflictCodes]);
  if (!callbacks[key]) {
    const rules = successCodes.length ? successCodes : [{ min: 200, max: 299 }];
    callbacks[key] = http.expectedStatuses(...rules, ...conflictCodes);
  }
  return callbacks[key];
}

export function configureExpectedStatuses(successCodes = [], conflictCodes = []) {
  http.setResponseCallback(expectedCallback(successCodes, conflictCodes));
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
  timeout = durationEnv('REQUEST_TIMEOUT', '30s'),
  successCodes = [],
  conflictCodes = [],
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

  return http.request(upperMethod, joinUrl(baseUrl, path), payload, {
    headers,
    tags: { name: tags.api || `${upperMethod} ${path}`, ...tags },
    timeout,
    redirects: 0,
    responseCallback: expectedCallback(successCodes, conflictCodes),
  });
}
