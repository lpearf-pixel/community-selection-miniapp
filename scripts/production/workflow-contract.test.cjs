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
