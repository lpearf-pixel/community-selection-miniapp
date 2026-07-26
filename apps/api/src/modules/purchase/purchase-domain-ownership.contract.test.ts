import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function source(relativePath: string) {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    'utf8',
  );
}

function expectNoMutation(text: string, models: string[]) {
  for (const model of models) {
    expect(text).not.toMatch(
      new RegExp(
        `tx\\.${model}\\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\\s*\\(`,
      ),
    );
  }
}

describe('purchase receive domain ownership contract', () => {
  it('keeps the purchase service as a public coordinator', () => {
    const text = source('./purchase-service.ts');
    expect(text).toContain('executeAdminPurchaseReceiveCommand');
    expect(text).toContain('transitionPurchasePlan');
    expect(text).not.toContain('receivePurchaseStock');
    expectNoMutation(text, [
      'purchasePlanItem',
      'product',
      'stockLedger',
      'productBatch',
      'batchStockLedger',
    ]);
  });

  it('keeps the executor out of four business write domains', () => {
    const text = source('./admin-purchase-receive-executor.ts');
    expect(text).toContain('lockPurchasePlan');
    expect(text).toContain('receivePurchaseInventory');
    expect(text).toContain('createPurchaseBatch');
    expect(text).toContain('applyPurchaseReceipt');
    expect(text).toContain('recordAdminAudit');
    expectNoMutation(text, [
      'purchasePlan',
      'purchasePlanItem',
      'product',
      'stockLedger',
      'productBatch',
      'batchStockLedger',
      'adminAuditLog',
    ]);
  });

  it('forbids reverse writes from each narrow owner', () => {
    expectNoMutation(source('./purchase-plan-owner.ts'), [
      'product',
      'stockLedger',
      'productBatch',
      'batchStockLedger',
      'adminAuditLog',
      'adminCommandReceipt',
    ]);
    expectNoMutation(
      source('../inventory/purchase-inventory-owner.ts'),
      [
        'purchasePlan',
        'purchasePlanItem',
        'productBatch',
        'batchStockLedger',
        'adminAuditLog',
        'adminCommandReceipt',
      ],
    );
    expectNoMutation(source('../inventory/purchase-batch-owner.ts'), [
      'purchasePlan',
      'purchasePlanItem',
      'product',
      'stockLedger',
      'adminAuditLog',
      'adminCommandReceipt',
    ]);
  });

  it('routes purchase receiving through strict parsing and typed errors', () => {
    const text = source('../../routes/inventory.ts');
    expect(text).toContain('parseAdminPurchaseReceiveCommand');
    expect(text).toContain('AdminPurchaseReceiveCommandError');
    expect(text).not.toContain('request.body as ReceivePurchasePlanBody');
  });
});
