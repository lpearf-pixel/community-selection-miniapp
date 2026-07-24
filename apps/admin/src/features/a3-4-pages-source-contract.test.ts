import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  const url = new URL(relativePath, import.meta.url);
  return existsSync(url) ? readFileSync(url, 'utf8') : '';
}

describe('A3.4 finance, operations, and system page boundaries', () => {
  const pages = [
    [
      'finance/withdrawals/WithdrawalsPage.tsx',
      '提现管理加载失败',
      'WithdrawalsPage',
    ],
    [
      'operations/alerts/OperationsAlertsPage.tsx',
      '运营告警加载失败',
      'OperationsAlertsPage',
    ],
    [
      'finance/tax-review/TaxReviewPage.tsx',
      '税务人工 Review 加载失败',
      'TaxReviewPage',
    ],
  ] as const;

  it.each(pages)(
    'gives %s a generation-safe loader and local retry',
    (path, errorMessage) => {
      const source = read(path);

      expect(source).toContain('useFeatureResourceLoader');
      expect(source).toContain('refreshVersion');
      expect(source).toContain('onMutationCommitted');
      expect(source).toContain('onMessage');
      expect(source).toContain(`message="${errorMessage}"`);
      expect(source).toMatch(/onClick=\{retry\}[\s\S]*?>\s*重试\s*</);
      expect(source).not.toContain('refreshLegacyFeatures');
      expect(source).not.toContain('refreshBusinessFeatures');
    },
  );

  it('removes all three legacy domains from AdminApp ownership', () => {
    const source = read('../app/AdminApp.tsx');

    for (const fragment of [
      'type Withdrawal =',
      'type OpsAlert =',
      'type TaxRecord =',
      'refreshLegacyFeatures',
      'reviewWithdrawalTax',
      'updateWithdrawal',
      'updateAlert',
      'const [withdrawals, setWithdrawals]',
      'const [alerts, setAlerts]',
      'const [taxRecords, setTaxRecords]',
      '"/api/admin/withdrawals"',
      '"/api/admin/logs/alerts"',
      '"/api/admin/tax-records"',
    ]) {
      expect(source, fragment).not.toContain(fragment);
    }
  });

  it('lets repeated withdrawal and tax queries trigger a fresh load', () => {
    for (const path of [
      'finance/withdrawals/WithdrawalsPage.tsx',
      'finance/tax-review/TaxReviewPage.tsx',
    ]) {
      const source = read(path);

      expect(source, path).toContain('queryVersion');
      expect(source, path).toContain(
        'setQueryVersion((version) => version + 1)',
      );
    }
  });
});
