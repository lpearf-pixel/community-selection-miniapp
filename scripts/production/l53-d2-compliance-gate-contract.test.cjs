const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workflowPath = path.resolve(
  __dirname,
  '../../.github/workflows/l53-d2-compliance-gate.yml',
);

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('defines a focused L53-D2 PostgreSQL compliance gate', () => {
  assert.equal(
    fs.existsSync(workflowPath),
    true,
    'L53-D2 compliance workflow must exist',
  );
  const workflow = fs.readFileSync(workflowPath, 'utf8');

  assert.match(workflow, /runs-on:\s*\[\s*self-hosted\s*,\s*community\s*\]/);
  assert.doesNotMatch(workflow, /community-w01/);
  assert.doesNotMatch(workflow, /continue-on-error:\s*true/);
  assert.match(workflow, /host\.docker\.internal:\$\{port\}/);
  assert.match(workflow, /POSTGRES_HOST_PORT=\$\{port\}/);
  assert.match(
    workflow,
    /docker compose\s+\\?\s*\n?\s*-p community-selection-l53-d2-\$\{\{ github\.run_id \}\}/,
  );
  assert.match(workflow, /up -d --wait postgres/);
  assert.match(
    workflow,
    /pnpm exec prisma migrate deploy --schema prisma\/schema\.prisma/,
  );
  for (const testFile of [
    'supplier-qualification-command.test.ts',
    'supplier-qualification-route.test.ts',
    'supplier-qualification-executor.integration.test.ts',
    'product-batch-evidence.test.ts',
    'purchase-batch-owner.test.ts',
    'admin-purchase-receive-command.test.ts',
    'purchase-domain-ownership.contract.test.ts',
    'product-compliance-command.test.ts',
    'product-compliance-executor.test.ts',
    'product-compliance-executor.integration.test.ts',
    'routes/admin/compliance.test.ts',
    'product-compliance-fingerprint.test.ts',
    'compliance-release-evaluator.test.ts',
    'compliance-release-evaluator.integration.test.ts',
    'verify-l53-d2-compliance-release-local.test.ts',
    'l53-d2-release-registration.contract.test.cjs',
  ]) {
    assert.match(workflow, new RegExp(escapeRegex(testFile)));
  }
  assert.match(
    workflow,
    /pnpm exec tsx scripts\/verify-l53-d2-compliance-release-local\.ts/,
  );
  assert.match(workflow, /pnpm --filter @community-selection\/api typecheck/);
  assert.match(workflow, /pnpm lint/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /down --volumes --remove-orphans \|\| true/);

  for (const requiredPath of [
    '.github/workflows/l53-d2-compliance-gate.yml',
    'scripts/production/l53-d2-compliance-gate-contract.test.cjs',
    'scripts/production/l53-d2-release-registration.contract.test.cjs',
    'scripts/verify-l53-d2-compliance-release-local.ts',
    'scripts/verify-l53-d2-compliance-release-local.test.ts',
    'scripts/verification-baseline-manifest.ts',
    'scripts/verify-all-local.sh',
    'apps/api/src/modules/compliance/supplier-qualification-command.ts',
    'apps/api/src/modules/compliance/supplier-qualification-executor.ts',
    'apps/api/src/modules/compliance/supplier-qualification-executor.integration.test.ts',
    'apps/api/src/modules/supplier/supplier-service.ts',
    'apps/api/src/routes/suppliers.ts',
    'apps/api/src/routes/supplier-qualification-route.test.ts',
    'apps/api/src/modules/compliance/product-batch-evidence.ts',
    'apps/api/src/modules/compliance/product-batch-evidence.test.ts',
    'apps/api/src/modules/inventory/purchase-batch-owner.ts',
    'apps/api/src/modules/inventory/purchase-batch-owner.test.ts',
    'apps/api/src/modules/purchase/admin-purchase-receive-command.ts',
    'apps/api/src/modules/purchase/admin-purchase-receive-command.test.ts',
    'apps/api/src/modules/compliance/product-compliance-command.ts',
    'apps/api/src/modules/compliance/product-compliance-command.test.ts',
    'apps/api/src/modules/compliance/product-compliance-executor.ts',
    'apps/api/src/modules/compliance/product-compliance-executor.test.ts',
    'apps/api/src/modules/compliance/product-compliance-executor.integration.test.ts',
    'apps/api/src/modules/compliance/compliance-release-evaluator.ts',
    'apps/api/src/modules/compliance/compliance-release-evaluator.test.ts',
    'apps/api/src/modules/compliance/compliance-release-evaluator.integration.test.ts',
    'apps/api/src/routes/admin/compliance.ts',
    'apps/api/src/routes/admin/compliance.test.ts',
    'apps/api/src/routes/admin/index.ts',
    'apps/api/src/modules/compliance/product-compliance-fingerprint.ts',
    'apps/api/src/modules/compliance/product-compliance-fingerprint.test.ts',
    'docker-compose.yml',
    'prisma/schema.prisma',
    'prisma/migrations/202607290002_l53_d2_product_compliance/**',
  ]) {
    assert.match(
      workflow,
      new RegExp(`^\\s*- ${escapeRegex(requiredPath)}\\s*$`, 'm'),
      `missing pull-request path ${requiredPath}`,
    );
  }

  assert.doesNotMatch(workflow, /verify:all/);
  assert.doesNotMatch(workflow, /e2e:admin|browser/i);
  assert.doesNotMatch(workflow, /upload-artifact|source snapshot/i);
});
