const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const workflowFile = path.join(
  root,
  '.github/workflows/l57-production-gray-release-gate.yml',
);

function workflow() {
  assert.equal(fs.existsSync(workflowFile), true, 'L57 workflow must exist');
  return fs.readFileSync(workflowFile, 'utf8');
}

test('runs the L57 gate for stable-branch pull requests on a GitHub-hosted runner', () => {
  const source = workflow();

  assert.match(source, /pull_request:/);
  assert.match(source, /stable\/l50-a3-4-business-base/);
  assert.match(source, /runs-on:\s*ubuntu-latest/);
  assert.doesNotMatch(source, /runs-on:\s*\[?\s*self-hosted/);
  assert.doesNotMatch(source, /community-w01/);
  assert.match(source, /contents: read/);
});

test('uses the pinned toolchain and frozen dependency graph', () => {
  const source = workflow();

  assert.match(source, /pnpm\/action-setup@v4/);
  assert.match(source, /version: 9\.15\.4/);
  assert.match(source, /actions\/setup-node@v4/);
  assert.match(source, /node-version: 22\.14\.0/);
  assert.match(source, /pnpm install --frozen-lockfile/);
  assert.match(source, /pnpm db:generate/);
});

test('runs production, migration, lint, type, test, and build gates', () => {
  const source = workflow();

  assert.match(source, /uses: \.\/\.github\/actions\/configure-ci-postgres/);
  assert.match(source, /up -d --wait postgres/);
  assert.match(source, /Resolve PostgreSQL endpoint for runner topology/);
  assert.match(source, /docker inspect .*\$\{HOSTNAME\}/);
  assert.match(source, /\.NetworkSettings\.Networks/);
  assert.match(source, /POSTGRES_HOST=\$\{db_host\}/);
  assert.match(source, /DATABASE_URL=\$\{database_url\}/);
  assert.doesNotMatch(source, /172\.1[6-9]\.0\.1/);
  assert.match(source, /prisma migrate deploy --schema prisma\/schema\.prisma/);
  assert.match(source, /if: always\(\)/);
  assert.match(source, /down --volumes --remove-orphans/);
  for (const command of [
    'pnpm --filter @community-selection/config build',
    'node --test scripts/production/*.test.cjs',
    'pnpm migrations:check',
    'pnpm lint',
    'pnpm typecheck',
    'pnpm test',
    'pnpm build',
  ]) {
    assert.ok(source.includes(`run: ${command}`), `missing workflow command: ${command}`);
  }
});

test('never connects to or mutates production', () => {
  const source = workflow();

  assert.doesNotMatch(source, /prod:deploy|prod:rollback|restore-drill\.sh/);
  assert.doesNotMatch(source, /\bssh\b|\bscp\b|appleboy|TencentCloudApi/);
  assert.doesNotMatch(source, /secrets\.[A-Za-z0-9_]+/);
});
