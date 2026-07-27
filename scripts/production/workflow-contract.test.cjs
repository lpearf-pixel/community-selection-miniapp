const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workflow = fs.readFileSync(
  path.resolve(__dirname, '../../.github/workflows/l52-production-readiness.yml'),
  'utf8',
);

test('runs for every stable-branch pull request change', () => {
  assert.doesNotMatch(workflow, /^\s+paths:\s*$/m);
});

test('uses the checked-out commit as the production image tag', () => {
  assert.match(workflow, /IMAGE_TAG:\s*\$\{\{\s*github\.sha\s*\}\}/);
  assert.doesNotMatch(workflow, /IMAGE_TAG=0123456789abcdef/);
});

test('stages API-owned fixture secrets without requiring host root', () => {
  assert.match(workflow, /docker volume create[\s\S]*docker create[\s\S]*docker cp/);
  assert.match(workflow, /chown 1000:1000[\s\S]*wechat_private_key\.pem/);
  assert.doesNotMatch(workflow, /^\s*chown 1000:1000/m);
  assert.doesNotMatch(workflow, /-v "\$\{PWD\}\/secrets:\/secrets"/);
  assert.match(
    workflow,
    /--api-runtime-uid "\$\(id -u\)"/,
  );
});

test('renders and validates the final CI topology before building images', () => {
  const renderStep = workflow.indexOf(
    'node scripts/production/render-l52-compose.mjs',
  );
  const finalValidation = workflow.indexOf(
    '-f .github/l52-compose.rendered.json config --quiet',
  );
  const buildStep = workflow.indexOf('build api edge backup');

  assert.match(workflow, /docker compose version/);
  assert.ok(renderStep >= 0);
  assert.ok(finalValidation > renderStep);
  assert.ok(buildStep > finalValidation);
  assert.doesNotMatch(workflow, /l52-compose\.override\.yml/);
  assert.doesNotMatch(workflow, /\bsubpath:/);
});

test('invokes the Caddy binary explicitly when validating the edge image', () => {
  assert.match(
    workflow,
    /run --rm --no-deps edge\s+\\?\s*caddy validate --config \/etc\/caddy\/Caddyfile/,
  );
});

test('bounds migration waits and preserves failed migration diagnostics', () => {
  assert.match(workflow, /timeout 240s "\$\{compose\[@\]\}" up -d --wait postgres/);
  assert.match(
    workflow,
    /timeout 180s "\$\{compose\[@\]\}" run --name "\$\{migration_container\}" migrate/,
  );
  assert.doesNotMatch(workflow, /run --rm migrate/);
  assert.match(workflow, /docker inspect "\$\{migration_container\}"/);
  assert.match(workflow, /docker logs "\$\{migration_container\}"/);
  assert.match(workflow, /docker rm -f "\$\{migration_container\}"/);
  assert.match(workflow, /"\$\{compose\[@\]\}" ps --all/);
  assert.match(
    workflow,
    /"\$\{compose\[@\]\}" logs --no-color --tail 200 postgres/,
  );
});
