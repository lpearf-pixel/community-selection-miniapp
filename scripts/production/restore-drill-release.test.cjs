const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const releaseModule = import('./restore-drill-release.mjs').catch(() => ({}));

test('reads only an exact immutable release SHA from the drill env file', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'l57-release-'));
  const valid = path.join(directory, 'valid.env');
  const invalid = path.join(directory, 'invalid.env');
  fs.writeFileSync(valid, 'IMAGE_TAG=ac5c7cce158f5314db976ff2d130185292c46cad\n');
  fs.writeFileSync(invalid, 'IMAGE_TAG=latest\n');

  const { readRestoreDrillReleaseSha } = await releaseModule;
  assert.equal(typeof readRestoreDrillReleaseSha, 'function');
  assert.equal(
    readRestoreDrillReleaseSha(valid),
    'ac5c7cce158f5314db976ff2d130185292c46cad',
  );
  assert.throws(() => readRestoreDrillReleaseSha(invalid), /exact lowercase 40-character/);
});
