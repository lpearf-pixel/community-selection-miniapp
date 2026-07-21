const path = require('node:path');

const DEFAULT_CLI_PATH = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli';
const DEFAULT_PORT = 9420;
const DEFAULT_HEALTH_URL = 'http://127.0.0.1:13080/api/health';
const DEFAULT_HEALTH_TIMEOUT_MS = 30000;
const DEFAULT_COMPOSE_WAIT_SECONDS = 300;
const DEFAULT_COMPOSE_SERVICES = Object.freeze(['postgres', 'api']);

function assertSupportedPlatform(platform = process.platform) {
  if (platform !== 'darwin') {
    throw new Error('Mini Program click smoke requires macOS and WeChat DevTools');
  }
}

function parsePort(value) {
  const port = Number(value || DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid MINIAPP_AUTOMATION_PORT: ${value}`);
  }
  return port;
}

function parsePositiveInteger(value, fallback, name) {
  const number = Number(value || fallback);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`Invalid ${name}: ${value}`);
  }
  return number;
}

function resolveE2eConfig(options = {}) {
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  const repoRoot = options.repoRoot || path.resolve(__dirname, '../..');
  assertSupportedPlatform(platform);
  return {
    cliPath: env.WECHAT_CLI_PATH || DEFAULT_CLI_PATH,
    projectPath: path.resolve(env.MINIAPP_PROJECT_PATH || path.join(repoRoot, 'apps/miniapp')),
    port: parsePort(env.MINIAPP_AUTOMATION_PORT),
  };
}

function resolveContainerConfig(options = {}) {
  const env = options.env || process.env;
  const repoRoot = options.repoRoot || path.resolve(__dirname, '../..');
  return {
    repoRoot,
    composeFile: path.resolve(env.MINIAPP_E2E_COMPOSE_FILE || path.join(repoRoot, 'docker-compose.yml')),
    healthUrl: env.MINIAPP_E2E_HEALTH_URL || DEFAULT_HEALTH_URL,
    healthTimeoutMs: parsePositiveInteger(
      env.MINIAPP_E2E_HEALTH_TIMEOUT_MS,
      DEFAULT_HEALTH_TIMEOUT_MS,
      'MINIAPP_E2E_HEALTH_TIMEOUT_MS',
    ),
    waitTimeoutSeconds: parsePositiveInteger(
      env.MINIAPP_E2E_COMPOSE_WAIT_SECONDS,
      DEFAULT_COMPOSE_WAIT_SECONDS,
      'MINIAPP_E2E_COMPOSE_WAIT_SECONDS',
    ),
    services: [...DEFAULT_COMPOSE_SERVICES],
  };
}

function resolveMiniappApiBaseUrl(env = process.env) {
  const value = String(env.MINIAPP_E2E_API_BASE_URL || DEFAULT_HEALTH_URL.replace('/api/health', ''))
    .trim()
    .replace(/\/+$/, '');
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error(`Invalid MINIAPP_E2E_API_BASE_URL: ${value}`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`Invalid MINIAPP_E2E_API_BASE_URL: ${value}`);
  }
  return value;
}

function composePrefix(config) {
  return [
    'compose',
    '--file', config.composeFile,
    '--project-directory', config.repoRoot,
  ];
}

function composeUpArgs(config) {
  return [
    ...composePrefix(config),
    'up',
    '-d',
    '--wait',
    '--wait-timeout',
    String(config.waitTimeoutSeconds),
    ...config.services,
  ];
}

function composePsArgs(config) {
  return [...composePrefix(config), 'ps', '--all', ...config.services];
}

function composeLogsArgs(config) {
  return [
    ...composePrefix(config),
    'logs',
    '--no-color',
    '--tail',
    '200',
    ...config.services,
  ];
}

function composeStopArgs(config) {
  return [...composePrefix(config), 'stop', ...config.services];
}

function assertHomeApiReady(data = {}) {
  if (data.productsLoading || data.groupBuysLoading) return false;
  const errors = [
    ['products', data.productsError],
    ['group buys', data.groupBuysError],
  ].filter(([, message]) => message);
  if (errors.length) {
    throw new Error(`Home API request failed: ${errors.map(([name, message]) => `${name}: ${message}`).join('; ')}`);
  }
  return true;
}

async function overrideMiniappApiBaseUrl(miniProgram, apiBaseUrl) {
  const previousValue = await miniProgram.callWxMethod('getStorageSync', 'API_BASE_URL');
  await miniProgram.callWxMethod('setStorageSync', 'API_BASE_URL', apiBaseUrl);
  return previousValue;
}

async function restoreMiniappApiBaseUrl(miniProgram, previousValue) {
  if (previousValue === undefined || previousValue === null || previousValue === '') {
    await miniProgram.callWxMethod('removeStorageSync', 'API_BASE_URL');
    return;
  }
  await miniProgram.callWxMethod('setStorageSync', 'API_BASE_URL', previousValue);
}

function normalizePagePath(value) {
  return String(value || '').replace(/^\/+/, '');
}

function assertPagePath(actual, expected) {
  const actualPath = normalizePagePath(actual);
  const expectedPath = normalizePagePath(expected);
  if (actualPath !== expectedPath) {
    throw new Error(`Expected page ${expectedPath}, received ${actualPath || '<none>'}`);
  }
}

function artifactPaths(baseDir = '/tmp', now = new Date()) {
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  const prefix = path.join(baseDir, `chunhuaqiushi-miniapp-e2e-${timestamp}`);
  return {
    log: `${prefix}.log`,
    screenshot: `${prefix}.png`,
    composeLog: `${prefix}-compose.log`,
  };
}

module.exports = {
  artifactPaths,
  assertHomeApiReady,
  assertPagePath,
  assertSupportedPlatform,
  composeLogsArgs,
  composePsArgs,
  composeStopArgs,
  composeUpArgs,
  normalizePagePath,
  overrideMiniappApiBaseUrl,
  resolveContainerConfig,
  resolveE2eConfig,
  resolveMiniappApiBaseUrl,
  restoreMiniappApiBaseUrl,
};
