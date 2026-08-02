const assert = require('node:assert/strict');
const test = require('node:test');

test('builds a loopback-only Admin process without forwarding WeChat secrets', async () => {
  const { buildAdminProcessSpec } = await import('./admin.mjs');
  const config = {
    appId: 'wx1234567890abcdef',
    appSecret: 'a'.repeat(32),
    sessionTokenSecret: 'b'.repeat(32),
    adminToken: 'c'.repeat(32),
    apiPort: 13180,
    adminPort: 13181,
    ttlMinutes: 120,
  };
  const spec = buildAdminProcessSpec(config, {
    apiPort: 13180,
  }, {
    PATH: '/usr/local/bin:/usr/bin',
    LANG: 'zh_CN.UTF-8',
  });

  assert.equal(spec.command, 'pnpm');
  assert.deepEqual(spec.args, [
    '--filter',
    '@community-selection/admin',
    'exec',
    'vite',
    '--host',
    '127.0.0.1',
    '--port',
    '13181',
  ]);
  assert.equal(spec.env.VITE_API_BASE_URL, 'http://127.0.0.1:13180');
  assert.equal(spec.env.VITE_ADMIN_TOKEN, config.adminToken);
  assert.equal(spec.env.PATH, '/usr/local/bin:/usr/bin');
  assert.equal(spec.env.WECHAT_APP_SECRET, undefined);
  assert.equal(spec.env.USER_SESSION_TOKEN_SECRET, undefined);
  assert.equal(spec.env.WECHAT_APP_ID, undefined);
  assert.equal(spec.options.shell, false);
  assert.equal(spec.options.stdio, 'inherit');
});

test('refuses an Admin process when local config and running state ports differ', async () => {
  const { buildAdminProcessSpec } = await import('./admin.mjs');
  assert.throws(
    () =>
      buildAdminProcessSpec(
        { adminPort: 13181, apiPort: 13180, adminToken: 'c'.repeat(32) },
        { apiPort: 23180 },
        {},
      ),
    /API port.*running demo/i,
  );
});
