import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pageSource = readFileSync(
  new URL('./AfterSalesPage.tsx', import.meta.url),
  'utf8',
);
const hookSource = readFileSync(
  new URL('./useRefundExecution.ts', import.meta.url),
  'utf8',
);

describe('after-sales refund execution structure', () => {
  it('shows a dedicated action only for an executable approved refund', () => {
    expect(pageSource).toContain('canExecuteApprovedRefund(item)');
    expect(pageSource).toContain('执行退款');
    expect(pageSource).toContain('approved_refund_cents');
    expect(pageSource).not.toMatch(/请输入确认退款金额/);
  });

  it('keeps one idempotency key per case attempt and refreshes conflicts', () => {
    expect(hookSource).toContain('crypto.randomUUID()');
    expect(hookSource).toContain('attemptKeys.current.get(afterSale.id)');
    expect(hookSource).toContain('error.status === 409');
    expect(hookSource).toContain('onConflictRefresh');
  });
});
