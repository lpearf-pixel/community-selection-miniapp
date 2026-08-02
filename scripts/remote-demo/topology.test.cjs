const assert = require('node:assert/strict');
const fs = require('node:fs');
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

test('accepts only the isolated two-service demo topology', async () => {
  const { assertResolvedDemoTopology } = await import('./topology.mjs');
  const { renderDemoCompose } = await import('./compose.mjs');
  const model = renderDemoCompose(config, {
    repoRoot: '/workspace/community-selection-miniapp',
  });

  assert.doesNotThrow(() => assertResolvedDemoTopology(model, config));
  assert.throws(
    () => assertResolvedDemoTopology({
      ...model,
      services: {
        ...model.services,
        admin: { image: 'unexpected-admin' },
      },
    }, config),
    /exactly api and postgres/,
  );
  assert.throws(
    () => assertResolvedDemoTopology({
      ...model,
      services: {
        ...model.services,
        postgres: { ...model.services.postgres, ports: ['5432:5432'] },
      },
    }, config),
    /PostgreSQL must not publish a port/,
  );
  assert.throws(
    () => assertResolvedDemoTopology({
      ...model,
      services: {
        ...model.services,
        api: {
          ...model.services.api,
          environment: {
            ...model.services.api.environment,
            WECHAT_PAY_MODE: 'wechat',
          },
        },
      },
    }, config),
    /mock commerce/,
  );
});

test('renders a private temporary file, invokes Compose, and removes it', async () => {
  const { verifyDemoTopology } = await import('./topology.mjs');
  let composeFile;

  await verifyDemoTopology({
    repoRoot: path.resolve(__dirname, '../..'),
    config,
    runCompose({ file, projectName }) {
      composeFile = file;
      assert.equal(projectName, 'community-selection-l58-demo');
      assert.equal(fs.statSync(file).mode & 0o777, 0o600);
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    },
  });

  assert.equal(fs.existsSync(composeFile), false);
  assert.equal(fs.existsSync(path.dirname(composeFile)), false);
});
