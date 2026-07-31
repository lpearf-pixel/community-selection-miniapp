const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const manifest = fs.readFileSync(
  path.join(root, 'verification-baseline-manifest.ts'),
  'utf8',
);
const verifyAll = fs.readFileSync(
  path.join(root, 'verify-all-local.sh'),
  'utf8',
);
const complianceCli = fs.readFileSync(
  path.join(root, 'verify-l53-d2-compliance-release-local.ts'),
  'utf8',
);

test('registers the L53-D2 compliance release verifier without removing baselines', () => {
  const command =
    'pnpm exec tsx scripts/verify-l53-d2-compliance-release-local.ts';
  assert.match(manifest, /l53-d2-compliance-release/);
  assert.match(manifest, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(verifyAll, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(verifyAll, /verify-l10-security-local/);
  assert.match(verifyAll, /run-registered-stage-verifiers/);

  for (const id of [
    'raw-compliance-terms',
    'db-generate',
    'db-migrate',
    'db-seed',
    'seed-check',
    'typecheck',
    'lint',
    'test',
    'build',
    'validate-env',
    'check-migrations',
    'compliance-scan',
  ]) {
    assert.match(manifest, new RegExp(`command\\('${id}'`));
  }
  for (const verifier of [
    'verify-l10-security-local.ts',
    'verify-l11-admin-auth-local.ts',
    'verify-l12-fulfillment-local.ts',
    'verify-l13-inventory-purchase-local.ts',
    'verify-l14-batch-supplier-loss-local.ts',
    'verify-l14-5-modular-boundary-local.ts',
    'verify-l15-after-sale-local.ts',
    'verify-l16-finance-reconciliation-local.ts',
    'verify-l17-operations-dashboard-local.ts',
    'verify-l17-5-normal-purchase-local.ts',
    'verify-l18-user-order-center-local.ts',
    'verify-l19-product-purchase-entry-local.ts',
    'verify-l20-miniapp-e2e-release-local.ts',
    'verify-l21-miniapp-location-selection-local.ts',
    'verify-l22-miniapp-order-center-local.ts',
    'verify-l49-brand-home-local.ts',
    'verify-l23-mvp-release-readiness-local.ts',
  ]) {
    const pattern = new RegExp(verifier.replaceAll('.', '\\.'));
    assert.match(manifest, pattern);
    assert.match(verifyAll, pattern);
  }
  assert.match(manifest, /\.\.\.globalStatic/);
  assert.match(manifest, /\.\.\.registeredStages/);
  assert.doesNotMatch(
    complianceCli,
    /^\s*await\s+main\(\);/m,
    "the release CLI must remain executable through tsx's CJS output",
  );
  assert.match(
    complianceCli,
    /main\(\)\.catch\(/,
    'the release CLI must fail closed when its entrypoint rejects',
  );
});
