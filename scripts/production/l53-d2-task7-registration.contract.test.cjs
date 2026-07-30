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

test('registers Task 7 in the focused GitHub-hosted compliance gate', () => {
  assert.equal(fs.existsSync(workflowPath), true, 'workflow must exist');
  const workflow = fs.readFileSync(workflowPath, 'utf8');

  assert.match(workflow, /runs-on:\s*\[\s*self-hosted\s*,\s*community\s*\]/);
  assert.doesNotMatch(workflow, /community-w01/);
  assert.doesNotMatch(workflow, /continue-on-error:\s*true/);

  for (const file of [
    'apps/api/src/routes/admin/compliance-access.test.ts',
    'apps/api/src/routes/admin/compliance-evidence-access.integration.test.ts',
    'apps/admin/src/features/inventory/shared/types.ts',
    'apps/admin/src/features/supply/suppliers/api.ts',
    'apps/admin/src/features/supply/suppliers/SuppliersPage.tsx',
    'apps/admin/src/features/catalog/compliance/**',
    'apps/admin/src/features/catalog/products/CatalogProductsPage.tsx',
    'scripts/production/l53-d2-task7-registration.contract.test.cjs',
  ]) {
    assert.match(
      workflow,
      new RegExp(`^\\s*- ${escapeRegex(file)}\\s*$`, 'm'),
      `missing Task 7 trigger ${file}`,
    );
  }

  for (const testFile of [
    'compliance-access.test.ts',
    'compliance-evidence-access.integration.test.ts',
    'catalog/compliance/api.test.ts',
    'product-compliance-panel.test.tsx',
    'supply/suppliers/api.test.ts',
    'supplier-compliance-card.test.tsx',
    'catalog-compliance-mount.contract.test.ts',
    'l53-d2-task7-registration.contract.test.cjs',
  ]) {
    assert.match(workflow, new RegExp(escapeRegex(testFile)));
  }
  assert.match(
    workflow,
    /pnpm --filter @community-selection\/admin typecheck/,
  );
  assert.doesNotMatch(workflow, /verify:all|e2e:admin|browser|community-w01/i);
});
