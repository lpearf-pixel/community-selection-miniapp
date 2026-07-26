import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

const directWrites =
  /\.(withdrawal|withdrawalCommission|commission|rewardLedger|taxRecord|adminAuditLog)\.(create|createMany|update|updateMany|upsert)\s*\(/;

describe('withdrawal domain ownership contract', () => {
  it('keeps Fastify routes free of withdrawal-domain table writes', () => {
    const route = source('../../routes/withdrawals.ts');
    expect(route).not.toMatch(directWrites);
    expect(route).toContain('executeLeaderWithdrawalCommand');
    expect(route).toContain('executeAdminWithdrawalTaxReviewCommand');
    expect(route).toContain('executeAdminWithdrawalCommand');
  });

  it('keeps orchestrators behind domain owners', () => {
    for (const path of [
      './leader-withdrawal-executor.ts',
      './admin-withdrawal-tax-review-executor.ts',
      './admin-withdrawal-executor.ts',
    ]) {
      expect(source(path), path).not.toMatch(directWrites);
    }
  });

  it('assigns each table write to exactly one narrow owner', () => {
    const withdrawal = source('./withdrawal-owner.ts');
    const commission = source('./withdrawal-commission-owner.ts');
    const reward = source('./withdrawal-reward-ledger-owner.ts');
    const tax = source('../tax-record/withdrawal-tax-owner.ts');

    expect(withdrawal).toMatch(/tx\.withdrawal\.create\s*\(/);
    expect(withdrawal).toMatch(/tx\.withdrawalCommission\.createMany\s*\(/);
    expect(withdrawal).not.toMatch(
      /\.(commission|rewardLedger|taxRecord|adminAuditLog)\.(create|update|updateMany|upsert)\s*\(/,
    );
    expect(commission).toMatch(/tx\.commission\.updateMany\s*\(/);
    expect(commission).not.toMatch(
      /\.(withdrawal|rewardLedger|taxRecord|adminAuditLog)\.(create|update|updateMany|upsert)\s*\(/,
    );
    expect(reward).toContain('appendRewardLedgerEntry');
    expect(reward).not.toMatch(
      /\.(withdrawal|commission|taxRecord|adminAuditLog)\.(create|update|updateMany|upsert)\s*\(/,
    );
    expect(tax).toMatch(/tx\.taxRecord\.upsert\s*\(/);
    expect(tax).not.toMatch(
      /\.(withdrawal|commission|rewardLedger|adminAuditLog)\.(create|update|updateMany|upsert)\s*\(/,
    );
  });

  it('requires deterministic row locks and reliable receipts', () => {
    expect(source('./withdrawal-commission-owner.ts')).toContain('FOR UPDATE');
    expect(source('./withdrawal-owner.ts')).toContain('FOR UPDATE');
    const taxExecutor = source('./admin-withdrawal-tax-review-executor.ts');
    expect(taxExecutor).toContain('admin.withdrawal.tax-review.v1');
    expect(taxExecutor).toContain('adminCommandReceipt.create');
    expect(taxExecutor).toContain('adminCommandReceipt.update');
    expect(taxExecutor.indexOf('recordAdminAudit')).toBeLessThan(
      taxExecutor.lastIndexOf('adminCommandReceipt.update'),
    );
  });
});
