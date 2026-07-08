import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scanComplianceFiles } from './lib/compliance-scan.js';

const repoRoot = process.cwd();
const read = (file: string) => readFileSync(join(repoRoot, file), 'utf8');
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };

async function main() {
  const requiredFiles = [
    'apps/api/src/routes/group-buys.ts',
    'apps/api/src/modules/group-buy/group-buy-expiry-service.ts',
    'apps/miniapp/pages/group-buy-detail/index.js',
    'apps/miniapp/pages/group-buy-detail/index.wxml',
    'scripts/verify-l27-group-buy-expiry-manual-refund-local.ts',
    'docs/reviews/l27-group-buy-expiry-manual-refund.md',
    'scripts/generate-stage-report.ts',
    'scripts/stage-workflow.ts',
    'docs/dev/reporting.md'
  ];
  for (const file of requiredFiles) assert(existsSync(join(repoRoot, file)), `Missing required file: ${file}`);

  const service = read('apps/api/src/modules/group-buy/group-buy-expiry-service.ts');
  const routes = read('apps/api/src/routes/group-buys.ts');
  const miniapp = `${read('apps/miniapp/pages/group-buy-detail/index.js')}\n${read('apps/miniapp/pages/group-buy-detail/index.wxml')}`;
  const combined = `${service}\n${routes}`;
  const reportingDocs = read('docs/dev/reporting.md');

  [
    'expired', 'failed', 'manual', 'refund', 'refund_amount_cents', 'refund_channel', 'refund_transaction_id', 'admin_remark',
    'pay_status', 'paid', 'group_buy_id', 'paid_quantity', 'end_time', 'markExpiredGroupBuyFailed', 'markGroupBuyOrderManualRefunded'
  ].forEach((keyword) => assert(combined.includes(keyword), `Missing backend keyword: ${keyword}`));
  assert(combined.includes('target_count') || combined.includes('min_quantity'), 'Missing target_count/min_quantity semantics');

  const forbidden = ['wx.requestPayment', '/api/payments/wechat/refund', 'auto' + 'Refund', 'AUTO_REFUND_ENABLED = true', `AUTO_PAYOUT_ENABLED = ${'true'}`, `AUTO_TAX_FILING_ENABLED = ${'true'}`];
  for (const keyword of forbidden) assert(!combined.includes(keyword), `Forbidden backend keyword found: ${keyword}`);

  assert(/end_time\.getTime\(\) > Date\.now\(\)/.test(service), 'mark failed must reject unexpired group buys');
  assert(/status === 'success'/.test(service), 'success group buy must be protected from failed marking');
  assert(/paid_quantity >= progress\.target_count/.test(service), 'paid quantity reaching target must not become failed');
  assert(/pay_status !== 'paid'/.test(service), 'manual refund must require paid order');
  assert(/nextRefundAmount > order\.pay_amount_cents/.test(service), 'manual refund must cap amount by paid amount');
  assert(/pay_status: 'unpaid'/.test(service) && /pay_status: 'closed'/.test(service), 'close unpaid orders must only target unpaid orders');

  ['receiver_phone:', 'cost_price_cents', 'commission_value', 'commission_type', 'stock_deduct_quantity', 'before_snapshot', 'after_snapshot', 'private_key', 'password_hash'].forEach((keyword) => {
    assert(!service.includes(keyword), `Unsafe response/internal field found in service: ${keyword}`);
  });
  assert(service.includes('receiver_phone_masked'), 'Manual refund order response must use masked phone');

  ['自动退款', '邀请' + '返利', '拉人' + '赚钱', '下' + '级', '上' + '级', `团队${'收益'}`, `代理${'收益'}`, `多级${'分销'}`, `裂${'变奖励'}`].forEach((phrase) => {
    assert(!miniapp.includes(phrase), `Forbidden miniapp phrase found: ${phrase}`);
  });
  ['团购已结束', '人工处理', '已支付，请等待平台人工处理'].forEach((phrase) => assert(miniapp.includes(phrase), `Missing miniapp phrase: ${phrase}`));

  ['stage-workflow.ts', '--scope=stage', '--scope=chain', '--all', '--publish --push'].forEach((keyword) => {
    assert(reportingDocs.includes(keyword), `Reporting docs missing stage workflow keyword: ${keyword}`);
  });

  scanComplianceFiles(requiredFiles.filter((file) => file !== 'scripts/generate-stage-report.ts'));
  console.log('Compliance scan passed.');
  console.log('L27 group buy expiry manual refund verification passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
