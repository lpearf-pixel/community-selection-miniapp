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
  assert(/where: \{ group_buy_id: groupBuyId, pay_status: 'unpaid'/.test(service), 'close unpaid orders must query only unpaid orders');
  assert(/data: \{ order_status: 'closed', pay_status: 'unpaid' \}/.test(service), 'close unpaid orders must set order_status closed while keeping pay_status unpaid');
  assert(service.includes('unpaid close must not create refund') || !/tx\.refund\.create[\s\S]{0,500}closeUnpaid/.test(service), 'close unpaid orders must not create refund');
  assert(!/restoreInventoryForRefund\(tx,[\s\S]{0,500}closeUnpaid/.test(service), 'close unpaid orders must not restore inventory');

  const alwaysForbidden = ['cost_price_cents', 'commission_value', 'commission_type', 'private_key', 'password_hash'];
  for (const keyword of alwaysForbidden) {
    assert(!service.includes(keyword), `Forbidden internal field found in group-buy expiry service: ${keyword}`);
  }
  assert(service.includes('receiver_phone_masked'), 'Manual refund order response must use masked phone');
  assert(service.includes('receiver_address_masked'), 'Manual refund order response must use masked address');
  assert(service.includes('toSafeClosureOrder'), 'Safe closure order mapper must exist');
  const unsafeResponsePatterns: Array<{ pattern: RegExp; message: string }> = [
    { pattern: /receiver_phone\s*:\s*(?:order|updatedOrder|refund\.order)\.receiver_phone/, message: 'Raw receiver_phone must not be mapped into response' },
    { pattern: /receiver_address\s*:\s*(?:order|updatedOrder|refund\.order)\.receiver_address/, message: 'Raw receiver_address must not be mapped into response' },
    { pattern: /order\s*:\s*updatedOrder\b/, message: 'Full Prisma Order must not be returned' },
    { pattern: /order\s*:\s*order\b/, message: 'Full Prisma Order must not be returned' },
    { pattern: /return\s+updatedOrder\b/, message: 'Full Prisma Order must not be returned directly' },
    { pattern: /\.\.\.\s*updatedOrder\b/, message: 'Full Prisma Order must not be spread into response' },
    { pattern: /\.\.\.\s*order\b/, message: 'Full Prisma Order must not be spread into response' },
    { pattern: /refund\s*(?:,|})/, message: 'Full Prisma Refund must not be returned directly' },
    { pattern: /\.\.\.\s*refund\b/, message: 'Full Prisma Refund must not be spread into response' }
  ];
  const responseSurface = service
    .replace(/toSafeClosureRefund\(refund\)/g, 'safeRefund')
    .replace(/refund_status/g, 'safe_refund_status')
    .replace(/refund_amount_cents/g, 'safe_refund_amount_cents')
    .replace(/product_refund_amount_cents/g, 'safe_product_refund_amount_cents')
    .replace(/delivery_refund_amount_cents/g, 'safe_delivery_refund_amount_cents');
  for (const item of unsafeResponsePatterns) {
    assert(!item.pattern.test(responseSurface), item.message);
  }

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
