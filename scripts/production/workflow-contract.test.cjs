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

test('runs production containers with the container-runner secrets override', () => {
  assert.match(
    workflow,
    /-f \.github\/l52-compose\.override\.yml/,
  );
  assert.match(workflow, /L52_SECRETS_VOLUME/);
});
