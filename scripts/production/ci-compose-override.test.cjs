const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const overridePath = path.resolve(
  __dirname,
  '../../.github/l52-compose.override.yml',
);

test('replaces only secret bind mounts with an isolated CI named volume', () => {
  assert.equal(fs.existsSync(overridePath), true, 'CI Compose override is required');
  const source = fs.readFileSync(overridePath, 'utf8');
  for (const service of ['migrate', 'api', 'backup', 'restore']) {
    assert.match(source, new RegExp(`\\n  ${service}:\\n`));
  }
  assert.equal((source.match(/!override/g) ?? []).length, 4);
  assert.match(source, /l52-secrets:\/run\/secrets:ro/);
  assert.match(
    source,
    /name:\s*\$\{L52_SECRETS_VOLUME:\?L52_SECRETS_VOLUME is required\}/,
  );
  assert.doesNotMatch(source, /\.\/secrets\//);
});
