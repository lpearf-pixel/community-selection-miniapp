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

  assert.doesNotMatch(runner, /docker-compose\.e2e\.yml/);
  assert.doesNotMatch(runner, /['"]postgres['"],\s*['"]api['"],\s*['"]admin['"]/);
  assert.match(runner, /@community-selection\/api/);
  assert.match(runner, /@community-selection\/admin/);
  assert.match(runner, /ADMIN_E2E_DATABASE_URL/);
});
