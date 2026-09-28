export function requiredEnv(name) {
  const value = __ENV[name];
  if (value === undefined || String(value).trim() === '') {
    throw new Error(`필수 환경변수 ${name}이(가) 없습니다.`);
  }
  return String(value).trim();
}

export function optionalEnv(name, fallback = '') {
  const value = __ENV[name];
  return value === undefined || String(value).trim() === ''
    ? fallback
    : String(value).trim();
}

export function integerEnv(name, fallback) {
  const raw = optionalEnv(name, String(fallback));
  const value = /^[0-9]+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name}은(는) 1 이상의 정수여야 합니다.`);
  }
  return value;
}

export function requiredIntegerEnv(name) {
  const raw = requiredEnv(name);
  const value = /^[0-9]+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name}은(는) 1 이상의 정수여야 합니다.`);
  }
  return value;
}

export function durationEnv(name, fallback = '') {
  const raw = fallback ? optionalEnv(name, fallback) : requiredEnv(name);
  if (!/^\d+(\.\d+)?[smh]$/.test(raw)) {
    throw new Error(`${name}은(는) 30s, 3m, 1h 형식이어야 합니다.`);
  }
  return raw;
}

export function durationToSeconds(duration) {
  const value = Number.parseFloat(duration.slice(0, -1));
  const unit = duration.slice(-1);
  const multiplier = unit === 'h' ? 3600 : unit === 'm' ? 60 : 1;
  return value * multiplier;
}

export function csvStatusCodes(name, fallback = []) {
  const raw = optionalEnv(name, '');
  if (!raw) return fallback;

  return raw.split(',').map((item) => {
    const code = Number.parseInt(item.trim(), 10);
    if (!Number.isInteger(code) || code < 100 || code > 599) {
      throw new Error(`${name}에 올바르지 않은 HTTP 상태 코드가 있습니다: ${item}`);
    }
    return code;
  });
}

export function csvValues(name, fallback = []) {
  const raw = optionalEnv(name, '');
  if (!raw) return fallback;

  const values = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (values.length === 0) {
    throw new Error(`${name}에는 쉼표로 구분한 값이 하나 이상 필요합니다.`);
  }
  return values;
}

export function requiredCsvValues(name) {
  const values = csvValues(name);
  if (values.length === 0) {
    throw new Error(`필수 환경변수 ${name}이(가) 없습니다.`);
  }
  return values;
}

export function parseJsonEnv(name) {
  const raw = requiredEnv(name);
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${name}은(는) 유효한 JSON이어야 합니다: ${error.message}`);
  }
}

export function parseOptionalJsonEnv(name, fallback = {}) {
  const raw = optionalEnv(name, '');
  if (!raw) return fallback;

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${name}은(는) 유효한 JSON이어야 합니다: ${error.message}`);
  }
}

export function joinUrl(baseUrl, path) {
  return `${baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}
