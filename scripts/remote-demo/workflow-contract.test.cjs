const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const workflowFile = path.join(root, '.github/workflows/l58-remote-demo-gate.yml');
const l57WorkflowFile = path.join(
  root,
  '.github/workflows/l57-production-gray-release-gate.yml',
);

function readWorkflow(file, label) {
  assert.equal(fs.existsSync(file), true, `${label} workflow must exist`);
  return fs.readFileSync(file, 'utf8');
}

test('runs the isolated L58 gate on a GitHub-hosted runner', () => {
  const source = readWorkflow(workflowFile, 'L58');

  assert.match(source, /pull_request:/);
  assert.match(source, /stable\/l50-a3-4-business-base/);
  assert.match(source, /runs-on:\s*ubuntu-latest/);
  assert.doesNotMatch(source, /self-hosted|community-w01/);
  assert.match(source, /permissions:\s*\n\s*contents:\s*read/);

  for (const changedPath of [
    '.github/workflows/l58-remote-demo-gate.yml',
    'scripts/remote-demo/**',
    'apps/miniapp/config.js',
    'apps/miniapp/pages/orders/confirm/**',
    'apps/admin/src/shared/api/**',
  ]) {
    assert.ok(source.includes(changedPath), `missing L58 path: ${changedPath}`);
  }
});

test('uses isolated PostgreSQL and runs the complete L58 candidate gate', () => {
  const source = readWorkflow(workflowFile, 'L58');

  assert.match(source, /uses:\s*\.\/\.github\/actions\/configure-ci-postgres/);
  assert.match(source, /docker compose[\s\S]*up -d --wait postgres/);
  assert.match(source, /prisma migrate deploy --schema prisma\/schema\.prisma/);
  assert.match(source, /pnpm test:remote-demo/);
  assert.match(source, /pnpm demo:remote:verify-topology/);
  assert.match(source, /pnpm lint/);
  assert.match(source, /pnpm typecheck/);
  assert.match(source, /pnpm test/);
  assert.match(source, /pnpm build/);
  assert.match(source, /if:\s*always\(\)[\s\S]*down --volumes --remove-orphans/);
  assert.doesNotMatch(source, /secrets\.[A-Za-z0-9_]+|prod:deploy|prod:rollback|\bssh\b|\bscp\b/);
});

test('keeps L58 concerns out of the existing GitHub-hosted L57 gate', () => {
  const source = readWorkflow(l57WorkflowFile, 'L57');

  assert.match(source, /runs-on:\s*ubuntu-latest/);
  assert.doesNotMatch(source, /self-hosted|community-w01/);
  assert.doesNotMatch(source, /scripts\/remote-demo|demo:remote:verify-topology/);
});
