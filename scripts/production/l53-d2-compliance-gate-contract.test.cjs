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
  assert.match(workflow, /pnpm exec prisma migrate deploy --schema prisma\/schema\.prisma/);
  assert.match(workflow, /supplier-qualification-command\.test\.ts/);
  assert.match(workflow, /supplier-qualification-route\.test\.ts/);
  assert.match(workflow, /supplier-qualification-executor\.integration\.test\.ts/);
  assert.match(workflow, /product-batch-evidence\.test\.ts/);
  assert.match(workflow, /purchase-batch-owner\.test\.ts/);
  assert.match(workflow, /admin-purchase-receive-command\.test\.ts/);
  assert.match(workflow, /purchase-domain-ownership\.contract\.test\.ts/);
  assert.match(workflow, /product-compliance-command\.test\.ts/);
  assert.match(workflow, /product-compliance-executor\.test\.ts/);
  assert.match(workflow, /product-compliance-executor\.integration\.test\.ts/);
  assert.match(workflow, /routes\/admin\/compliance\.test\.ts/);
  assert.match(workflow, /product-compliance-fingerprint\.test\.ts/);
  assert.match(workflow, /pnpm --filter @community-selection\/api typecheck/);
  assert.match(workflow, /pnpm lint/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /down --volumes --remove-orphans \|\| true/);

  for (const requiredPath of [
    '.github/workflows/l53-d2-compliance-gate.yml',
    'scripts/production/l53-d2-compliance-gate-contract.test.cjs',
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
