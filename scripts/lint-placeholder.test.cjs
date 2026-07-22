const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { dirname, join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

const scanner = resolve(__dirname, 'lint-placeholder.js');
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'l1-lint-'));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
  return root;
}

function run(root) {
  return spawnSync(process.execPath, [scanner], { cwd: root, encoding: 'utf8' });
}

const localMacPath = '/' + 'Users/tester/project';
const containerStorePath = '/' + 'root/.local/share/pnpm/store';
const legacyRewardTerm = '返' + '利';
const distributionTerm = '分' + '销';

describe('L1 lightweight lint exemptions', () => {
  it('allows only the known verifier fixtures and container cache paths', () => {
    const root = fixture({
      'docker-compose.yml': `store: ${containerStorePath}`,
      'scripts/generate-stage-report.ts': `const legacy = '${legacyRewardTerm}'`,
      'scripts/miniapp-e2e/home-smoke.test.cjs': `const fixture = '${localMacPath}'`,
      'scripts/verify-docker-compose-local.ts': `const expected = '${containerStorePath}'`,
      'scripts/verify-l26-group-buy-success-rule-local.ts': `const terms = '${legacyRewardTerm} ${distributionTerm}'`,
      'scripts/verify-l27-group-buy-expiry-manual-refund-local.ts': `const terms = '${legacyRewardTerm} ${distributionTerm}'`,
      'scripts/verify-l34-admin-data-scope-baseline-local.ts': `const terms = '${legacyRewardTerm} ${distributionTerm}'`,
      'scripts/verify-no-raw-compliance-terms-local.ts': `const terms = '${legacyRewardTerm} ${distributionTerm}'`,
    });

    const result = run(root);

    assert.equal(result.status, 0, result.stderr);
  });

  it('still rejects the same terms outside an exact exemption', () => {
    const root = fixture({
      'apps/admin/src/leaked-path.ts': `export const leaked = '${localMacPath}'`,
      'scripts/unapproved-verifier.ts': `export const legacy = '${legacyRewardTerm}'`,
    });

    const result = run(root);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /apps\/admin\/src\/leaked-path\.ts/);
    assert.match(result.stderr, /scripts\/unapproved-verifier\.ts/);
  });
});
