import fs from 'node:fs';
import path from 'node:path';

const ALLOWED_KEYS = new Set([
  'WECHAT_APP_ID',
  'WECHAT_APP_SECRET',
  'USER_SESSION_TOKEN_SECRET',
  'ADMIN_TOKEN',
  'DEMO_API_PORT',
  'DEMO_ADMIN_PORT',
  'DEMO_TTL_MINUTES',
]);

const REQUIRED_KEYS = [
  'WECHAT_APP_ID',
  'WECHAT_APP_SECRET',
  'USER_SESSION_TOKEN_SECRET',
  'ADMIN_TOKEN',
];

const DAILY_DEVELOPMENT_PORTS = new Set([13080, 13081]);

function unquote(value, key) {
  if (!value) return '';
  const first = value[0];
  const last = value.at(-1);
  if (first === '"' || first === "'") {
    if (last !== first || value.length < 2) {
      throw new Error(`${key} must use a plain value`);
    }
    return value.slice(1, -1);
  }
  return value;
}

export function parseDemoEnv(text) {
  if (typeof text !== 'string') {
    throw new Error('.env.demo.local must be text');
  }
  const result = {};
  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) {
      throw new Error(`Invalid .env.demo.local line ${index + 1}`);
    }
    const [, key, rawValue] = match;
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      throw new Error(`Duplicate demo configuration key: ${key}`);
    }
    if (
      rawValue.includes('$(') ||
      rawValue.includes('${') ||
      rawValue.includes('`') ||
      rawValue.includes('\0')
    ) {
      throw new Error(`${key} must use a plain value`);
    }
    result[key] = unquote(rawValue.trim(), key);
  }
  return result;
}

function requiredValue(values, key) {
  const value = values[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${key} is required`);
  }
  return value.trim();
}

function integerValue(values, key, fallback) {
  const raw = values[key];
  if (raw === undefined || raw === '') return fallback;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
    throw new Error(`${key} must be an integer`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${key} must be an integer`);
  }
  return value;
}

function validatePort(values, key, fallback) {
  const value = integerValue(values, key, fallback);
  if (value < 1 || value > 65_535 || DAILY_DEVELOPMENT_PORTS.has(value)) {
    throw new Error(
      `${key} must be an isolated port from 1 through 65535 and not 13080/13081`,
    );
  }
  return value;
}

export function validateDemoConfig(values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    throw new Error('Demo configuration must be an object');
  }
  for (const key of Object.keys(values)) {
    if (!ALLOWED_KEYS.has(key)) {
      throw new Error(`Demo configuration forbids key ${key}`);
    }
  }
  for (const key of REQUIRED_KEYS) requiredValue(values, key);

  const appId = requiredValue(values, 'WECHAT_APP_ID');
  if (!/^wx[A-Za-z0-9]{16}$/.test(appId)) {
    throw new Error('WECHAT_APP_ID must be a real Mini Program AppID');
  }
  const appSecret = requiredValue(values, 'WECHAT_APP_SECRET');
  if (appSecret.length < 32) {
    throw new Error('WECHAT_APP_SECRET must be at least 32 characters');
  }
  const sessionTokenSecret = requiredValue(
    values,
    'USER_SESSION_TOKEN_SECRET',
  );
  if (sessionTokenSecret.length < 32) {
    throw new Error(
      'USER_SESSION_TOKEN_SECRET must be at least 32 characters',
    );
  }
  const adminToken = requiredValue(values, 'ADMIN_TOKEN');
  if (adminToken.length < 32) {
    throw new Error('ADMIN_TOKEN must be at least 32 characters');
  }
  if (adminToken === sessionTokenSecret) {
    throw new Error(
      'ADMIN_TOKEN and USER_SESSION_TOKEN_SECRET must be independent',
    );
  }

  const apiPort = validatePort(values, 'DEMO_API_PORT', 13180);
  const adminPort = validatePort(values, 'DEMO_ADMIN_PORT', 13181);
  if (apiPort === adminPort) {
    throw new Error('DEMO_API_PORT and DEMO_ADMIN_PORT must be different');
  }
  const ttlMinutes = integerValue(values, 'DEMO_TTL_MINUTES', 120);
  if (ttlMinutes < 30 || ttlMinutes > 240) {
    throw new Error('DEMO_TTL_MINUTES must be from 30 through 240');
  }

  return Object.freeze({
    appId,
    appSecret,
    sessionTokenSecret,
    adminToken,
    apiPort,
    adminPort,
    ttlMinutes,
  });
}

export function loadDemoConfig({ repoRoot }) {
  if (typeof repoRoot !== 'string' || !path.isAbsolute(repoRoot)) {
    throw new Error('repoRoot must be an absolute path');
  }
  const envPath = path.join(repoRoot, '.env.demo.local');
  let stats;
  try {
    stats = fs.lstatSync(envPath);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw new Error('.env.demo.local is required');
    }
    throw error;
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error('.env.demo.local must be a regular file, not a symlink');
  }
  if ((stats.mode & 0o777) !== 0o600) {
    throw new Error('.env.demo.local permissions must be 0600');
  }
  return validateDemoConfig(
    parseDemoEnv(fs.readFileSync(envPath, 'utf8')),
  );
}
