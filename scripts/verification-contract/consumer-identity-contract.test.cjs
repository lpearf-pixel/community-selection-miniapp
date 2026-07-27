const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');
const {
  activeVerifierFiles,
  findConsumerIdentityViolations,
} = require('./consumer-identity-contract.cjs');

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'vcm1-contract-'));
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(
    join(root, 'scripts/verify-all-local.sh'),
    [
      'pnpm exec tsx scripts/verify-active-legacy-local.ts',
      'pnpm exec tsx scripts/verify-active-helper-local.ts',
      'pnpm exec tsx scripts/verify-active-header-local.ts',
    ].join('\n'),
  );
  writeFileSync(
    join(root, 'scripts/verify-active-legacy-local.ts'),
    [
      "await app.inject({ method: 'POST', url: '/api/orders',",
      '  payload: { user_id: user.id, quantity: 1 } });',
    ].join('\n'),
  );
  writeFileSync(
    join(root, 'scripts/verify-active-helper-local.ts'),
    [
      "await injectAsConsumer(app, user.id, { method: 'POST',",
      "  url: '/api/orders/normal', payload: { quantity: 1 } });",
    ].join('\n'),
  );
  writeFileSync(
    join(root, 'scripts/verify-active-header-local.ts'),
    [
      "await app.inject({ method: 'POST', url: '/api/orders',",
      "  headers: { 'x-user-id': user.id }, payload: { quantity: 1 } });",
    ].join('\n'),
  );
  writeFileSync(
    join(root, 'scripts/verify-inactive-legacy-local.ts'),
    "await app.inject({ method: 'POST', url: '/api/orders', payload: { user_id: user.id } });",
  );
  return root;
}

test('reports active body identity with the exact file and line', () => {
  const root = fixture();
  try {
    const files = activeVerifierFiles(root, []);
    const violations = findConsumerIdentityViolations(root, files);

    assert.deepEqual(files, [
      'scripts/verify-active-header-local.ts',
      'scripts/verify-active-helper-local.ts',
      'scripts/verify-active-legacy-local.ts',
    ]);
    assert.equal(violations.length, 1);
    assert.match(
      violations[0],
      /^scripts\/verify-active-legacy-local\.ts:1: .*user_id/,
    );
    assert.doesNotMatch(violations.join('\n'), /inactive/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('reports a protected request without helper or trusted header', () => {
  const root = fixture();
  try {
    writeFileSync(
      join(root, 'scripts/verify-active-header-local.ts'),
      "await app.inject({ method: 'POST', url: '/api/orders/normal', payload: { quantity: 1 } });",
    );

    const violations = findConsumerIdentityViolations(
      root,
      activeVerifierFiles(root, []),
    );

    assert.equal(violations.length, 2);
    assert.match(violations.join('\n'), /missing injectAsConsumer or x-user-id/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

