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
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name}은(는) 1 이상의 정수여야 합니다.`);
  }
  return value;
}

export function requiredIntegerEnv(name) {
  const raw = requiredEnv(name);
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name}은(는) 1 이상의 정수여야 합니다.`);
  }
  return value;
}

export function durationEnv(name, fallback = '') {
  const raw = fallback ? optionalEnv(name, fallback) : requiredEnv(name);
  if (!/^\d+(\.\d+)?(ms|s|m|h)$/.test(raw)
      || !Number.isFinite(durationToSeconds(raw)) || durationToSeconds(raw) <= 0) {
    throw new Error(`${name}은(는) 0보다 큰 500ms, 30s, 3m, 1h 형식이어야 합니다.`);
  }
  return raw;
}

export function durationToSeconds(duration) {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(duration);
  if (!match) throw new Error(`잘못된 시간 값: ${duration}`);
  const value = Number(match[1]);
  const unit = match[2];
  if (unit === 'ms') return value / 1000;
  const multiplier = unit === 'h' ? 3600 : unit === 'm' ? 60 : 1;
  return value * multiplier;
}

export function csvStatusCodes(name, fallback = []) {
  const raw = optionalEnv(name, '');
  if (!raw) return fallback;

  return raw.split(',').map((item) => {
    const code = Number(item.trim());
    if (!/^\d{3}$/.test(item.trim()) || !Number.isInteger(code) || code < 100 || code > 599) {
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

export function numberEnv(name, fallback, allowZero = false) {
  const raw = optionalEnv(name, String(fallback));
  const value = Number(raw);
  if (!/^\d+(\.\d+)?$/.test(raw) || !Number.isFinite(value)
      || (allowZero ? value < 0 : value <= 0)) {
    throw new Error(`${name}은(는) ${allowZero ? '0 이상의' : '0보다 큰'} 숫자여야 합니다.`);
  }
  return value;
}

export function databaseId(value, label) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) {
    throw new Error(`${label}: 큰 bigint ID는 JSON 문자열로 입력하세요.`);
  }
  const id = String(value);
  if (!/^[1-9]\d*$/.test(id)) throw new Error(`${label}: 실제 DB의 양의 정수 ID가 필요합니다.`);
  return id;
}
