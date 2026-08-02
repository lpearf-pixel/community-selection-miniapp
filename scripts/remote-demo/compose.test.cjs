const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const config = Object.freeze({
  appId: 'wx1234567890abcdef',
  appSecret: 'a'.repeat(32),
  sessionTokenSecret: 'b'.repeat(32),
  adminToken: 'c'.repeat(32),
  apiPort: 13180,
  adminPort: 13181,
  ttlMinutes: 120,
});

test('renders only an unpublished database and a loopback API', async () => {
  const { renderDemoCompose } = await import('./compose.mjs');
  const model = renderDemoCompose(config, {
    repoRoot: '/workspace/community-selection-miniapp',
  });

  assert.deepEqual(Object.keys(model.services).sort(), ['api', 'postgres']);
  assert.deepEqual(Object.keys(model.volumes).sort(), [
    'api_node_modules',
    'api_package_store',
    'postgres_data',
  ]);
  assert.equal(model.services.postgres.image, 'postgres:16');
  assert.equal(model.services.postgres.ports, undefined);
  assert.deepEqual(model.services.postgres.volumes, [
    {
      type: 'volume',
      source: 'postgres_data',
      target: '/var/lib/postgresql/data',
    },
  ]);
  assert.deepEqual(model.services.api.depends_on, {
    postgres: { condition: 'service_healthy' },
  });
  assert.deepEqual(model.services.api.ports, [
    {
      target: 13080,
      published: '13180',
      host_ip: '127.0.0.1',
      protocol: 'tcp',
    },
  ]);
});

test('pins mock commerce, real login, admin auth, and disabled automation', async () => {
  const { renderDemoCompose } = await import('./compose.mjs');
  const model = renderDemoCompose(config, {
    repoRoot: '/workspace/community-selection-miniapp',
  });
  const env = model.services.api.environment;

  assert.match(env.DATABASE_URL, /^postgresql:\/\/l58_demo:[^@]+@postgres:5432\/community_selection_l58_demo\?schema=public$/);
  assert.equal(env.NODE_ENV, 'development');
  assert.equal(env.PORT, '13080');
  assert.equal(env.WECHAT_APP_ID, config.appId);
  assert.equal(env.WECHAT_APP_SECRET, config.appSecret);
  assert.equal(env.USER_SESSION_TOKEN_SECRET, config.sessionTokenSecret);
  assert.equal(env.ADMIN_TOKEN, config.adminToken);
  assert.deepEqual(
    {
      WECHAT_PAY_MODE: env.WECHAT_PAY_MODE,
      MOCK_WECHAT_PAY: env.MOCK_WECHAT_PAY,
      CURRENT_USER_MOCK_HEADERS_ENABLED: env.CURRENT_USER_MOCK_HEADERS_ENABLED,
      ADMIN_AUTH_ENABLED: env.ADMIN_AUTH_ENABLED,
      ADMIN_AUTH_MODE: env.ADMIN_AUTH_MODE,
      AUTO_PAYOUT_ENABLED: env.AUTO_PAYOUT_ENABLED,
      AUTO_TAX_FILING_ENABLED: env.AUTO_TAX_FILING_ENABLED,
      FIRST_LAUNCH_MODE: env.FIRST_LAUNCH_MODE,
    },
    {
      WECHAT_PAY_MODE: 'mock',
      MOCK_WECHAT_PAY: 'true',
      CURRENT_USER_MOCK_HEADERS_ENABLED: 'false',
      ADMIN_AUTH_ENABLED: 'true',
      ADMIN_AUTH_MODE: 'token',
      AUTO_PAYOUT_ENABLED: 'false',
      AUTO_TAX_FILING_ENABLED: 'false',
      FIRST_LAUNCH_MODE: 'true',
    },
  );
  for (const forbidden of [
    'WECHAT_MCH_ID',
    'WECHAT_API_V3_KEY',
    'WECHAT_PRIVATE_KEY_PATH',
    'WECHAT_PAY_NOTIFY_URL',
    'WECHAT_REFUND_NOTIFY_URL',
  ]) {
    assert.equal(Object.prototype.hasOwnProperty.call(env, forbidden), false);
  }
});

test('runs migration and deterministic seed before the API dev server', async () => {
  const { renderDemoCompose } = await import('./compose.mjs');
  const model = renderDemoCompose(config, {
    repoRoot: '/workspace/community-selection-miniapp',
  });
  const command = model.services.api.command;

  assert.deepEqual(command.slice(0, 2), ['sh', '-lc']);
  const script = command[2];
  assert.ok(script.indexOf('prisma migrate deploy') >= 0);
  assert.ok(script.indexOf('pnpm db:seed') > script.indexOf('prisma migrate deploy'));
  assert.ok(
    script.indexOf('pnpm --filter @community-selection/api dev') >
      script.indexOf('pnpm db:seed'),
  );
  assert.deepEqual(model.services.api.volumes, [
    {
      type: 'bind',
      source: '/workspace/community-selection-miniapp',
      target: '/app',
    },
    {
      type: 'volume',
      source: 'api_node_modules',
      target: '/app/node_modules',
    },
    {
      type: 'volume',
      source: 'api_package_store',
      target: '/opt/pnpm/store',
    },
  ]);
});

test('writes private Compose JSON atomically', async () => {
  const { renderDemoCompose, writeDemoCompose } = await import('./compose.mjs');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'l58-compose-'));
  const outputPath = path.join(directory, 'runtime', 'compose.json');
  const model = renderDemoCompose(config, {
    repoRoot: '/workspace/community-selection-miniapp',
  });

  assert.equal(writeDemoCompose(model, outputPath), outputPath);
  assert.deepEqual(JSON.parse(fs.readFileSync(outputPath, 'utf8')), model);
  assert.equal(fs.statSync(outputPath).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(outputPath)).mode & 0o777, 0o700);
  assert.deepEqual(
    fs.readdirSync(path.dirname(outputPath)).sort(),
    ['compose.json'],
  );
});
