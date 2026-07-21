const path = require('node:path');

const DEFAULT_CLI_PATH = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli';
const DEFAULT_PORT = 9420;

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
  };
}

module.exports = {
  artifactPaths,
  assertPagePath,
  assertSupportedPlatform,
  normalizePagePath,
  resolveE2eConfig,
};
