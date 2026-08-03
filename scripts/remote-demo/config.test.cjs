const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const validValues = Object.freeze({
  WECHAT_APP_ID: 'wx1234567890abcdef',
  WECHAT_APP_SECRET: 'a'.repeat(32),
  USER_SESSION_TOKEN_SECRET: 'b'.repeat(32),
  ADMIN_TOKEN: 'c'.repeat(32),
});

async function loadModule() {
  return import('./config.mjs');
}

test('parses a strict non-executable env file and applies safe defaults', async () => {
  const { parseDemoEnv, validateDemoConfig } = await loadModule();
  const parsed = parseDemoEnv([
    '# L58 local credentials',
    `WECHAT_APP_ID=${validValues.WECHAT_APP_ID}`,
    `WECHAT_APP_SECRET="${validValues.WECHAT_APP_SECRET}"`,
    `USER_SESSION_TOKEN_SECRET='${validValues.USER_SESSION_TOKEN_SECRET}'`,
    `ADMIN_TOKEN=${validValues.ADMIN_TOKEN}`,
    '',
  ].join('\n'));

  assert.deepEqual(validateDemoConfig(parsed), {
    appId: validValues.WECHAT_APP_ID,
    appSecret: validValues.WECHAT_APP_SECRET,
    sessionTokenSecret: validValues.USER_SESSION_TOKEN_SECRET,
    adminToken: validValues.ADMIN_TOKEN,
    apiPort: 13180,
    adminPort: 13181,
    ttlMinutes: 120,
  });
});

test('rejects shell syntax and duplicate keys instead of evaluating them', async () => {
  const { parseDemoEnv } = await loadModule();

  assert.throws(
    () => parseDemoEnv('WECHAT_APP_ID=$(whoami)'),
    /WECHAT_APP_ID.*plain value/i,
  );
  assert.throws(
    () => parseDemoEnv('ADMIN_TOKEN=first\nADMIN_TOKEN=second'),
    /duplicate.*ADMIN_TOKEN/i,
  );
});

test('rejects missing keys, placeholders, and malformed AppIDs', async () => {
  const { validateDemoConfig } = await loadModule();

  assert.throws(
    () => validateDemoConfig({ ...validValues, WECHAT_APP_SECRET: '' }),
    /WECHAT_APP_SECRET.*required/i,
  );
  assert.throws(
    () => validateDemoConfig({ ...validValues, WECHAT_APP_ID: 'REPLACE_WITH_WECHAT_APP_ID' }),
    /WECHAT_APP_ID/i,
  );
  assert.throws(
    () => validateDemoConfig({ ...validValues, WECHAT_APP_ID: 'wx-short' }),
    /WECHAT_APP_ID/i,
  );
});

test('requires long independent session and admin secrets', async () => {
  const { validateDemoConfig } = await loadModule();

  assert.throws(
    () => validateDemoConfig({ ...validValues, ADMIN_TOKEN: 'short' }),
    /ADMIN_TOKEN.*32/i,
  );
  assert.throws(
    () => validateDemoConfig({
      ...validValues,
      ADMIN_TOKEN: validValues.USER_SESSION_TOKEN_SECRET,
    }),
    /ADMIN_TOKEN.*USER_SESSION_TOKEN_SECRET.*independent/i,
  );
});

test('accepts only isolated ports and a TTL from 30 through 240 minutes', async () => {
  const { validateDemoConfig } = await loadModule();
  assert.deepEqual(
    validateDemoConfig({
      ...validValues,
      DEMO_API_PORT: '23180',
      DEMO_ADMIN_PORT: '23181',
      DEMO_TTL_MINUTES: '240',
    }),
    {
      appId: validValues.WECHAT_APP_ID,
      appSecret: validValues.WECHAT_APP_SECRET,
      sessionTokenSecret: validValues.USER_SESSION_TOKEN_SECRET,
      adminToken: validValues.ADMIN_TOKEN,
      apiPort: 23180,
      adminPort: 23181,
      ttlMinutes: 240,
    },
  );

  for (const [field, value] of [
    ['DEMO_API_PORT', '0'],
    ['DEMO_API_PORT', '65536'],
    ['DEMO_API_PORT', '13080'],
    ['DEMO_ADMIN_PORT', '13081'],
    ['DEMO_TTL_MINUTES', '29'],
    ['DEMO_TTL_MINUTES', '241'],
  ]) {
    assert.throws(
      () => validateDemoConfig({ ...validValues, [field]: value }),
      new RegExp(field),
    );
  }
  assert.throws(
    () => validateDemoConfig({
      ...validValues,
      DEMO_API_PORT: '23180',
      DEMO_ADMIN_PORT: '23180',
    }),
    /DEMO_API_PORT.*DEMO_ADMIN_PORT.*different/i,
  );
});

test('rejects every unknown or real-payment field without echoing its value', async () => {
  const { validateDemoConfig } = await loadModule();
  for (const key of [
    'DATABASE_URL',
    'WECHAT_MCH_ID',
    'WECHAT_API_V3_KEY',
    'WECHAT_PRIVATE_KEY_PATH',
    'WECHAT_PAY_NOTIFY_URL',
    'WECHAT_REFUND_NOTIFY_URL',
  ]) {
    const privateValue = `private-${key.toLowerCase()}`;
    assert.throws(
      () => validateDemoConfig({ ...validValues, [key]: privateValue }),
      (error) =>
        error instanceof Error &&
        error.message.includes(key) &&
        !error.message.includes(privateValue),
    );
  }
});

test('loads only a regular repository-root file with 0600 permissions', async () => {
  const { loadDemoConfig } = await loadModule();
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'l58-demo-config-'));
  const envPath = path.join(repoRoot, '.env.demo.local');
  const body = Object.entries(validValues)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  fs.writeFileSync(envPath, `${body}\n`, { mode: 0o600 });

  assert.equal(loadDemoConfig({ repoRoot }).apiPort, 13180);

  fs.chmodSync(envPath, 0o644);
  assert.throws(
    () => loadDemoConfig({ repoRoot }),
    /permissions.*0600/i,
  );

  fs.unlinkSync(envPath);
  const target = path.join(repoRoot, 'actual.env');
  fs.writeFileSync(target, `${body}\n`, { mode: 0o600 });
  fs.symlinkSync(target, envPath);
  assert.throws(
    () => loadDemoConfig({ repoRoot }),
    /regular file.*not a symlink/i,
  );
});
