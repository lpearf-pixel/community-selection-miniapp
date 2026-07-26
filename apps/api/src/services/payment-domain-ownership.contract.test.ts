import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

const coordinator = source('./payment-service.ts');
const paymentOwner = source('../modules/payment/payment-record-service.ts');
const orderOwner = source('../modules/order/order-payment-service.ts');
const groupBuyOwner = source(
  '../modules/group-buy/group-buy-payment-service.ts',
);

describe('payment success domain ownership contract', () => {
  it('keeps direct domain mutations out of the payment coordinator', () => {
    for (const forbidden of [
      /\btx\.payment\.(?:create|update|upsert|delete)/,
      /\btx\.order\.(?:create|update|updateMany|upsert|delete)/,
      /\btx\.groupBuy\.(?:create|update|upsert|delete)/,
      /\btx\.product\.(?:create|update|updateMany|upsert|delete)/,
      /\btx\.stockLedger\.(?:create|update|upsert|delete)/,
    ]) {
      expect(coordinator).not.toMatch(forbidden);
    }
  });

  it('coordinates through every required domain owner', () => {
    for (const required of [
      'findPaymentForOrder',
      'confirmPaymentRecordPaid',
      'deductInventoryForPaidOrder',
      'claimOrderPayment',
      'setPaidOrderStatus',
      'markGroupPaidOrdersGrouped',
      'recordPaidOrderEffects',
      'refreshGroupBuyAfterPayment',
    ]) {
      expect(coordinator).toContain(required);
    }
  });

  it('keeps each new owner inside its write boundary', () => {
    expect(paymentOwner).not.toMatch(
      /\btx\.(?:order|groupBuy|product|stockLedger)\.(?:create|update|updateMany|upsert|delete)/,
    );
    expect(orderOwner).not.toMatch(
      /\btx\.(?:payment|groupBuy|product|stockLedger)\.(?:create|update|updateMany|upsert|delete)/,
    );
    expect(groupBuyOwner).not.toMatch(
      /\btx\.(?:payment|order|product|stockLedger)\.(?:create|update|updateMany|upsert|delete)/,
    );
  });
});
