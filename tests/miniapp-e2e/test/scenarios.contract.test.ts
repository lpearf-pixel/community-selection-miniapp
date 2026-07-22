import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('business scenario framework contracts', () => {
  it('separates pickup/refund, delivery, and group-buy scenarios', () => {
    const scenarios: Record<string, string[]> = {
      'tests/miniapp-e2e/src/scenarios/ordinary-pickup-refund.ts': [
        'runOrdinaryPickupRefund',
        "'store'",
        'STORE_SEQUENCE',
        'applyAfterSale',
        'createFullMockRefund',
        "order_status: 'refunded'",
        "refund_status: 'success'",
      ],
      'tests/miniapp-e2e/src/scenarios/ordinary-delivery.ts': [
        'runOrdinaryDelivery',
        "'delivery'",
        'DELIVERY_SEQUENCE',
        'receiverAddress',
        "order_status: 'completed'",
      ],
      'tests/miniapp-e2e/src/scenarios/group-buy.ts': [
        'runGroupBuy',
        'miniapp-business-group-a-',
        'miniapp-business-group-b-',
        'assertGroupSucceeded',
        'STORE_SEQUENCE',
        'paid_quantity',
      ],
    };

    for (const [relativePath, markers] of Object.entries(scenarios)) {
      const source = read(relativePath);
      for (const marker of markers) expect(source, `${relativePath} missing ${marker}`).toContain(marker);
      expect(source).not.toContain('business-flow.cjs');
      expect(source).not.toContain('.callMethod(');
      expect(source).not.toMatch(/\.data\(\s*\)/);
    }
  });

  it('probes the loaded source contract before any business scenario', () => {
    const app = read('apps/miniapp/app.js');
    const session = read('tests/miniapp-e2e/src/project-session.ts');
    expect(app).toContain("e2eContractVersion: 'miniapp-e2e-v2'");
    expect(session).toContain('getApp().globalData.e2eContractVersion');
    expect(session).toContain("'miniapp-e2e-v2'");
    expect(session).toContain('MINIAPP_SOURCE_CONTRACT_MISMATCH');
  });

  it('runs all scenarios serially in one Vitest command with stable success markers', () => {
    const suite = read('tests/miniapp-e2e/test/business.e2e.test.ts');
    expect(suite).toContain('describe.sequential');
    expect(suite).toContain('runOrdinaryPickupRefund');
    expect(suite).toContain('runOrdinaryDelivery');
    expect(suite).toContain('runGroupBuy');
    expect(suite).toContain('ordinary_purchase_flow=passed');
    expect(suite).toContain('ordinary_delivery_flow=passed');
    expect(suite).toContain('group_buy_flow=passed');
    expect(suite).toContain('miniapp_business_e2e_exit=0');
  });

  it('keeps the real-payment boundary explicit', () => {
    const suite = read('tests/miniapp-e2e/test/business.e2e.test.ts');
    expect(suite).toContain('MOCK_WECHAT_PAY');
    expect(suite).toContain('Real WeChat payment is not covered');
  });
});
