const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const productionCompose = fs.readFileSync(
  path.resolve(__dirname, '../../docker-compose.production.yml'),
  'utf8',
);

const validEnv = {
  NODE_ENV: 'production',
  FIRST_LAUNCH_MODE: 'true',
  MEMBERSHIP_ENABLED: 'false',
  COUPONS_ENABLED: 'false',
  CASH_REWARDS_ENABLED: 'false',
  WITHDRAWALS_ENABLED: 'false',
  IMAGE_TAG: '0123456789abcdef',
  PORT: '13080',
  API_DOMAIN: 'api.example.com',
  ADMIN_DOMAIN: 'admin.example.com',
  ACME_EMAIL: 'ops@example.com',
  POSTGRES_DB: 'community_selection',
  POSTGRES_USER: 'community_selection',
  POSTGRES_PASSWORD: 'database_password_abcdefghijklmnopqrstuvwxyz',
  DATABASE_URL:
    'postgresql://community_selection:database_password_abcdefghijklmnopqrstuvwxyz@postgres:5432/community_selection?schema=public',
  ADMIN_AUTH_ENABLED: 'true',
  ADMIN_AUTH_MODE: 'session',
  ADMIN_TOKEN: 'admin-token-abcdefghijklmnopqrstuvwxyz',
  ADMIN_TOTP_ENCRYPTION_KEY: 'totp-key-abcdefghijklmnopqrstuvwxyz12',
  WECHAT_PAY_MODE: 'wechat',
  MOCK_WECHAT_PAY: 'false',
  CURRENT_USER_MOCK_HEADERS_ENABLED: 'false',
  WECHAT_APP_ID: 'wx-production',
  WECHAT_APP_SECRET: 'wechat-app-secret-abcdefghijklmnop',
  WECHAT_MCH_ID: '1900000001',
  WECHAT_MCH_SERIAL_NO: 'SERIAL123456',
  WECHAT_API_V3_KEY: '12345678901234567890123456789012',
  WECHAT_PRIVATE_KEY_PATH: '/run/secrets/wechat_private_key.pem',
  WECHAT_PAY_PLATFORM_SERIAL_NO: 'A1B2C3D4',
  WECHAT_PAY_PLATFORM_CERT_PATH:
    '/run/secrets/wechat_platform_certificate.pem',
  WECHAT_PAY_NOTIFY_URL:
    'https://api.example.com/api/payments/wechat/notify',
  WECHAT_REFUND_NOTIFY_URL:
    'https://api.example.com/api/refunds/wechat/notify',
  MINIAPP_API_BASE_URL: 'https://api.example.com',
  USER_SESSION_TOKEN_SECRET:
    'user-session-secret-abcdefghijklmnopqrstuvwxyz',
  AUTO_PAYOUT_ENABLED: 'false',
  AUTO_TAX_FILING_ENABLED: 'false',
  WECHAT_TRANSFER_ENABLED: 'false',
  WECHAT_MERCHANT_TRANSFER_ENABLED: 'false',
  BACKUP_RETENTION_DAYS: '14',
  BACKUP_ENCRYPTION_PASSPHRASE_FILE: '/run/secrets/backup_passphrase',
};

function secretFixture() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'community-selection-preflight-'),
  );
  const secrets = path.join(root, 'secrets');
  fs.mkdirSync(secrets);
  fs.writeFileSync(path.join(root, '.env.production'), 'NODE_ENV=production\n', {
    mode: 0o600,
  });
  execFileSync('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-subj',
    '/CN=preflight.test',
    '-keyout',
    path.join(secrets, 'wechat_private_key.pem'),
    '-out',
    path.join(secrets, 'wechat_platform_certificate.pem'),
    '-days',
    '1',
    '-set_serial',
    '0xA1B2C3D4',
  ], { stdio: 'ignore' });
  fs.chmodSync(path.join(secrets, 'wechat_private_key.pem'), 0o600);
  fs.chmodSync(path.join(secrets, 'wechat_platform_certificate.pem'), 0o600);
  fs.writeFileSync(
    path.join(secrets, 'backup_passphrase'),
    'backup-passphrase-abcdefghijklmnopqrstuvwxyz\n',
    { mode: 0o600 },
  );
  return root;
}

test('rejects a group or world readable production env file', async () => {
  const { preflightProduction } = await import('./preflight.mjs');
  const root = secretFixture();
  fs.chmodSync(path.join(root, '.env.production'), 0o644);
  await assert.rejects(
    () =>
      preflightProduction({
        env: validEnv,
        root,
        run() {
          return '';
        },
        log() {},
      }),
    /environment file.*group\/world/i,
  );
});

test('rejects malformed payment PEM files before Docker is invoked', async () => {
  const { preflightProduction } = await import('./preflight.mjs');
  const root = secretFixture();
  const key = path.join(root, 'secrets', 'wechat_private_key.pem');
  fs.writeFileSync(
    key,
    '-----BEGIN PRIVATE KEY-----\ninvalid\n-----END PRIVATE KEY-----\n',
    { mode: 0o600 },
  );
  let invoked = false;
  await assert.rejects(
    () =>
      preflightProduction({
        env: validEnv,
        root,
        run() {
          invoked = true;
          return '';
        },
        log() {},
      }),
    /private key.*invalid/i,
  );
  assert.equal(invoked, false);
});

test(
  'rejects payment secrets not owned by the API runtime uid',
  async () => {
    const { preflightProduction } = await import('./preflight.mjs');
    const root = secretFixture();
    const keyUid = fs.statSync(
      path.join(root, 'secrets', 'wechat_private_key.pem'),
    ).uid;
    await assert.rejects(
      () =>
        preflightProduction({
          env: validEnv,
          root,
          apiRuntimeUid: keyUid + 1,
          run() {
            return '';
          },
          log() {},
        }),
      /runtime uid/i,
    );
  },
);

test('rejects an expired payment platform certificate', async () => {
  const { validateCertificateMetadata } = await import('./preflight.mjs');
  assert.equal(typeof validateCertificateMetadata, 'function');
  assert.throws(
    () =>
      validateCertificateMetadata(
        {
          serialNumber: 'A1B2C3D4',
          validFrom: 'Jan 1 00:00:00 2020 GMT',
          validTo: 'Jan 2 00:00:00 2020 GMT',
        },
        'A1B2C3D4',
        new Date('2026-07-27T00:00:00Z'),
      ),
    /certificate is expired/i,
  );
});

test('rejects a platform certificate serial mismatch', async () => {
  const { preflightProduction } = await import('./preflight.mjs');
  await assert.rejects(
    () =>
      preflightProduction({
        env: {
          ...validEnv,
          WECHAT_PAY_PLATFORM_SERIAL_NO: 'DEADBEEF',
        },
        root: secretFixture(),
        run(command, args) {
          if (args[0] === 'compose' && args[1] === 'version') {
            return 'Docker Compose version v2.32.0';
          }
          return '';
        },
        log() {},
      }),
    /serial/i,
  );
});

test('parses quoted environment values and rejects duplicate keys', async () => {
  const { parseEnvText } = await import('./preflight.mjs');
  assert.deepEqual(parseEnvText('A=one\nB="two words"\n# ignored\n'), {
    A: 'one',
    B: 'two words',
  });
  assert.throws(() => parseEnvText('A=one\nA=two\n'), /Duplicate.*A/);
});

test('validates secrets and renders Compose without printing values', async () => {
  const { preflightProduction } = await import('./preflight.mjs');
  const root = secretFixture();
  const calls = [];
  const messages = [];
  await preflightProduction({
    env: validEnv,
    root,
    run(command, args) {
      calls.push([command, ...args]);
      if (args[0] === 'compose' && args[1] === 'version') {
        return 'Docker Compose version v2.32.0';
      }
      return '';
    },
    log(message) {
      messages.push(message);
    },
  });
  assert.ok(
    calls.some(
      (call) => call.includes('compose') && call.includes('config'),
    ),
  );
  assert.equal(
    messages.join('\n').includes(validEnv.POSTGRES_PASSWORD),
    false,
  );
});

test('rejects placeholder values before invoking Docker', async () => {
  const { preflightProduction } = await import('./preflight.mjs');
  let invoked = false;
  await assert.rejects(
    () =>
      preflightProduction({
        env: {
          ...validEnv,
          ADMIN_TOKEN: 'replace-with-random-secret-abcdefghijk',
        },
        root: secretFixture(),
        run() {
          invoked = true;
          return '';
        },
        log() {},
      }),
    /placeholder.*ADMIN_TOKEN/i,
  );
  assert.equal(invoked, false);
});

test('rejects a missing payment certificate', async () => {
  const { preflightProduction } = await import('./preflight.mjs');
  const root = secretFixture();
  fs.unlinkSync(
    path.join(root, 'secrets', 'wechat_platform_certificate.pem'),
  );
  await assert.rejects(
    () =>
      preflightProduction({
        env: validEnv,
        root,
        run() {
          return '';
        },
        log() {},
      }),
    /wechat_platform_certificate\.pem/,
  );
});

test('rejects Docker Compose v1', async () => {
  const { preflightProduction } = await import('./preflight.mjs');
  await assert.rejects(
    () =>
      preflightProduction({
        env: validEnv,
        root: secretFixture(),
        run(command, args) {
          if (args[0] === 'compose' && args[1] === 'version') {
            return 'docker-compose version 1.29.2';
          }
          return '';
        },
        log() {},
      }),
    /Compose v2/,
  );
});

test('parses an explicit CI fixture owner without changing the production default', async () => {
  const { parseApiRuntimeUid } = await import('./preflight.mjs');
  assert.equal(typeof parseApiRuntimeUid, 'function');
  assert.equal(parseApiRuntimeUid(undefined), 1000);
  assert.equal(parseApiRuntimeUid('1001'), 1001);
  assert.throws(() => parseApiRuntimeUid('-1'), /runtime uid/i);
  assert.throws(() => parseApiRuntimeUid('not-a-number'), /runtime uid/i);
});

test('pins every first-launch capability off in the production API environment', () => {
  for (const line of [
    'FIRST_LAUNCH_MODE: "true"',
    'MEMBERSHIP_ENABLED: "false"',
    'COUPONS_ENABLED: "false"',
    'CASH_REWARDS_ENABLED: "false"',
    'WITHDRAWALS_ENABLED: "false"',
  ]) {
    assert.ok(
      productionCompose.includes(line),
      `missing production Compose contract: ${line}`,
    );
  }
});
