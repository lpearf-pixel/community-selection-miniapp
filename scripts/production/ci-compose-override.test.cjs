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
  assert.doesNotMatch(source, /!override/);
  assert.match(source, /target:\s*\/run\/secrets\/wechat_private_key\.pem/);
  assert.match(source, /subpath:\s*wechat_private_key\.pem/);
  assert.match(
    source,
    /target:\s*\/run\/secrets\/wechat_platform_certificate\.pem/,
  );
  assert.match(source, /subpath:\s*wechat_platform_certificate\.pem/);
  assert.match(source, /target:\s*\/run\/secrets\/backup_passphrase/);
  assert.match(source, /subpath:\s*backup_passphrase/);
  assert.equal((source.match(/read_only:\s*true/g) ?? []).length, 6);
  assert.match(
    source,
    /name:\s*\$\{L52_SECRETS_VOLUME:\?L52_SECRETS_VOLUME is required\}/,
  );
  assert.doesNotMatch(source, /\.\/secrets\//);
});
