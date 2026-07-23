const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');

test('L50 Admin browser smoke infrastructure is complete', () => {
  const required = [
    'scripts/admin-e2e/package.json',
    'scripts/admin-e2e/pnpm-lock.yaml',
    'scripts/admin-e2e/admin-smoke.mjs',
    'scripts/admin-e2e/fixture.ts',
    'scripts/admin-e2e/run.cjs',
  ];
  for (const file of required) {
    assert.equal(fs.existsSync(path.join(root, file)), true, `missing ${file}`);
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['setup:admin:e2e'], 'pnpm --dir scripts/admin-e2e --ignore-workspace install --frozen-lockfile');
  assert.equal(pkg.scripts['e2e:admin'], 'node scripts/admin-e2e/run.cjs');

  const workspace = fs.readFileSync(
    path.join(root, 'apps/admin/src/app/AdminFeatureWorkspace.tsx'),
    'utf8',
  );
  assert.match(workspace, /__ADMIN_E2E_FORCE_RENDER_ERROR__/);
});

test('Admin E2E starts API and Admin natively on the runner', () => {
  const runner = fs.readFileSync(path.join(root, 'scripts/admin-e2e/run.cjs'), 'utf8');
  const viteConfig = fs.readFileSync(path.join(root, 'apps/admin/vite.config.ts'), 'utf8');

  assert.doesNotMatch(runner, /docker-compose\.e2e\.yml/);
  assert.doesNotMatch(runner, /['"]postgres['"],\s*['"]api['"],\s*['"]admin['"]/);
  assert.doesNotMatch(runner, /VITE_API_BASE_URL:\s*['"]https?:\/\//);
  assert.match(viteConfig, /['"]\/api['"]:\s*['"]http:\/\/localhost:13080['"]/);
  assert.match(runner, /@community-selection\/api/);
  assert.match(runner, /@community-selection\/admin/);
  assert.match(runner, /ADMIN_E2E_DATABASE_URL/);
});

test('Admin E2E keeps a native browser path for a physical runner', () => {
  const runner = fs.readFileSync(path.join(root, 'scripts/admin-e2e/run.cjs'), 'utf8');

  assert.match(runner, /if \(!existsSync\('\/\.dockerenv'\)\)/);
  assert.match(runner, /pnpm[\s\S]*--dir[\s\S]*scripts\/admin-e2e[\s\S]*test/);
});

test('A container runner executes Chromium in the matching Playwright image', () => {
  const runner = fs.readFileSync(path.join(root, 'scripts/admin-e2e/run.cjs'), 'utf8');

  assert.match(runner, /mcr\.microsoft\.com\/playwright:v\$\{playwrightVersion\}-noble/);
  assert.match(runner, /--network[\s\S]*container:\$\{runnerContainerId\}/);
  assert.match(runner, /PLAYWRIGHT_BROWSERS_PATH/);
  assert.match(runner, /docker[\s\S]*cp[\s\S]*admin-smoke\.mjs/);
});


test('Admin E2E verifies lazy feature requests, active refresh, and local retry', () => {
  const smoke = fs.readFileSync(
    path.join(root, 'scripts/admin-e2e/admin-smoke.mjs'),
    'utf8',
  );

  assert.match(smoke, /catalogRequestCount/);
  assert.match(smoke, /financeRequestCount/);
  assert.match(smoke, /operationsRequestCount/);
  assert.match(smoke, /catalogRequestsAfterInitial/);
  assert.match(smoke, /catalogFailureInjected/);
  assert.match(smoke, /financeRequestsBeforeSelection/);
  assert.match(smoke, /operationsRequestsBeforeSelection/);
  assert.match(smoke, /operationsFailureInjected/);
  assert.match(smoke, /商品目录加载失败/);
  assert.match(smoke, /财务对账加载失败/);
  assert.match(smoke, /运营看板加载失败/);
  assert.match(smoke, /getByRole\('button', \{ name: \/重\\s\*试\//);
});
