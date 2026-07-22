const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { assertSupportedNodeVersion } = require('./lib.cjs');

const repoRoot = path.resolve(__dirname, '../..');

test('accepts every Node line supported by the maintained automator', () => {
  for (const version of ['20.19.0', '20.20.1', '22.12.0', '24.0.0']) {
    assert.equal(assertSupportedNodeVersion(version), version);
  }
});

test('rejects Node versions that cannot parse the automator dependency graph', () => {
  for (const version of ['19.9.0', '20.18.1', '21.7.3', '22.11.0', 'invalid']) {
    assert.throws(
      () => assertSupportedNodeVersion(version),
      /requires Node\.js \^20\.19\.0 or >=22\.12\.0/,
    );
  }
});

test('checks Node before starting Docker or loading Vitest', () => {
  const source = fs.readFileSync(path.join(__dirname, 'container-runner.cjs'), 'utf8');
  const guard = source.indexOf('assertSupportedNodeVersion();');
  const docker = source.indexOf('runDocker(composeUpArgs(config), config);');
  assert.notEqual(guard, -1);
  assert.notEqual(docker, -1);
  assert.ok(guard < docker, 'Node version guard must run before Docker');
});

test('keeps the root runtime contract and nvm default aligned', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const nvmrc = fs.readFileSync(path.join(repoRoot, '.nvmrc'), 'utf8').trim();
  assert.equal(packageJson.engines.node, '^20.19.0 || >=22.12.0');
  assert.equal(nvmrc, '22');
});
