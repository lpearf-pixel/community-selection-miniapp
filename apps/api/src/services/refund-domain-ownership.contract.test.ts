import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

const coordinator = source('./refund-service.ts');
const adminCoordinator = source('../modules/refund/admin-refund-executor.ts');
const refundOwner = source('../modules/refund/refund-record-service.ts');
const orderOwner = source('../modules/order/order-refund-service.ts');
const afterSaleOwner = source(
  '../modules/after-sale/after-sale-refund-service.ts',
);
const creditOwner = source(
  '../modules/consumer-credit/order-refund-credit-service.ts',
);
const inventoryOwner = source(
  '../modules/inventory/inventory-order-service.ts',
);

const mutations = '(?:create|update|updateMany|upsert|delete)';

describe('refund success domain ownership contract', () => {
  it('keeps six business-domain mutations out of the refund coordinator', () => {
    for (const model of [
      'refund',
      'order',
      'afterSaleCase',
      'consumerCreditLedger',
      'product',
      'stockLedger',
      'commission',
    ]) {
      expect(coordinator).not.toMatch(
        new RegExp(`\\btx\\.${model}\\.${mutations}`),
      );
    }
  });

  it('coordinates through every applicable domain owner', () => {
    for (const required of [
      'lockRefundableOrder',
      'findRefundByClientKey',
      'createPendingRefund',
      'confirmRefundSuccess',
      'projectRefundSuccess',
      'restoreInventoryForRefund',
      'setRefundStockRestored',
      'returnOrderCreditAfterFullRefund',
      'syncCommissionAfterRefund',
      'recordRefundOrderEffects',
    ]) {
      expect(coordinator).toContain(required);
    }
  });

  it('keeps business-domain mutations out of the Admin coordinator', () => {
    for (const model of [
      'refund',
      'order',
      'afterSaleCase',
      'consumerCreditLedger',
      'product',
      'stockLedger',
      'commission',
    ]) {
      expect(adminCoordinator).not.toMatch(
        new RegExp(`\\btx\\.${model}\\.${mutations}`),
      );
    }
    expect(adminCoordinator).toContain('claimApprovedAfterSaleForRefund');
    expect(adminCoordinator).toContain('resolveAfterSaleWithRefund');
  });

  it('keeps each owner inside its write boundary', () => {
    expect(refundOwner).not.toMatch(
      /\btx\.(?:order|afterSaleCase|consumerCreditLedger|product|stockLedger|commission)\.(?:create|update|updateMany|upsert|delete)/,
    );
    expect(orderOwner).not.toMatch(
      /\btx\.(?:refund|afterSaleCase|consumerCreditLedger|product|stockLedger|commission)\.(?:create|update|updateMany|upsert|delete)/,
    );
    expect(creditOwner).not.toMatch(
      /\btx\.(?:refund|order|afterSaleCase|product|stockLedger|commission)\.(?:create|update|updateMany|upsert|delete)/,
    );
    expect(inventoryOwner).not.toMatch(
      /\btx\.(?:refund|order|afterSaleCase|consumerCreditLedger|commission)\.(?:create|update|updateMany|upsert|delete)/,
    );
    expect(afterSaleOwner).not.toMatch(
      /\btx\.(?:refund|order|consumerCreditLedger|product|stockLedger|commission)\.(?:create|update|updateMany|upsert|delete)/,
    );
  });
});
