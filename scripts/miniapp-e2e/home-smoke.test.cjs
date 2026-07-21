const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  artifactPaths,
  assertPagePath,
  assertSupportedPlatform,
  normalizePagePath,
  resolveE2eConfig,
} = require('./lib.cjs');

test('rejects platforms that cannot launch WeChat DevTools', () => {
  assert.throws(
    () => assertSupportedPlatform('linux'),
    /requires macOS and WeChat DevTools/,
  );
});

test('resolves stable Mac defaults from the repository root', () => {
  const repoRoot = '/Users/test/community-selection-miniapp';
  assert.deepEqual(resolveE2eConfig({ env: {}, platform: 'darwin', repoRoot }), {
    cliPath: '/Applications/wechatwebdevtools.app/Contents/MacOS/cli',
    projectPath: path.join(repoRoot, 'apps/miniapp'),
    port: 9420,
  });
});

test('normalizes page paths but still rejects the wrong destination', () => {
  assert.equal(normalizePagePath('/pages/products/index'), 'pages/products/index');
  assert.doesNotThrow(() => assertPagePath('/pages/products/index', 'pages/products/index'));
  assert.throws(
    () => assertPagePath('pages/orders/index', 'pages/products/index'),
    /Expected page pages\/products\/index, received pages\/orders\/index/,
  );
});

test('creates filesystem-safe evidence names', () => {
  const files = artifactPaths('/tmp', new Date('2026-07-20T12:34:56.789Z'));
  assert.match(files.log, /^\/tmp\/chunhuaqiushi-miniapp-e2e-2026-07-20T12-34-56-789Z\.log$/);
  assert.match(files.screenshot, /\.png$/);
  assert.doesNotMatch(files.log, /[: ]/);
});
