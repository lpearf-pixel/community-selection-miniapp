import { assertStageRegistered } from './stage-verifier-registration.ts';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scanComplianceFiles } from './lib/compliance-scan.js';

assertStageRegistered('L28', 'scripts/verify-l28-refund-ledger-finance-check-local.ts');
const repoRoot = process.cwd();
const read = (file: string) => readFileSync(join(repoRoot, file), 'utf8');
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };

async function main() {
  const requiredFiles = [
    'apps/api/src/modules/finance/finance-report-service.ts',
    'apps/api/src/modules/payment/wechat-payment-notification.ts',
    'apps/api/src/routes/admin/finance.ts',
    'prisma/schema.prisma',
    'scripts/verify-l28-refund-ledger-finance-check-local.ts',
    'scripts/stage-workflow.ts',
    'scripts/generate-stage-report.ts',
    'scripts/verify-all-local.sh',
    'docs/reviews/l28-refund-ledger-finance-check.md'
  ];
  for (const file of requiredFiles) assert(existsSync(join(repoRoot, file)), `Missing required file: ${file}`);

  const service = read('apps/api/src/modules/finance/finance-report-service.ts');
  const routes = read('apps/api/src/routes/admin/finance.ts');
  const schema = read('prisma/schema.prisma');
  const notification = read('apps/api/src/modules/payment/wechat-payment-notification.ts');
  const workflow = read('scripts/stage-workflow.ts');
  const report = read('scripts/generate-stage-report.ts');
  const verifyAll = read('scripts/verify-all-local.sh');
  const doc = read('docs/reviews/l28-refund-ledger-finance-check.md');
  const combined = `${service}\n${routes}`;

  [
    'getFinanceRefundLedger', 'getFinanceRefundLedgerCsv', 'refundWhere', 'order_no', 'group_buy_id', 'refund_method',
    'refund_status', 'refund_amount_cents', 'summary', 'refund_amount_cents: sum', 'receiver_phone_masked', 'maskPhone',
    'manual_record_only', 'provider_status', 'out_refund_no', 'export.csv', '/api/admin/finance/refund-ledger'
  ].forEach((keyword) => assert(combined.includes(keyword), `Missing refund ledger keyword: ${keyword}`));

  assert(!schema.includes('raw_notify'), 'Payment and Refund must not persist raw notification payloads');
  for (const keyword of ['model WechatNotificationReceipt', 'notification_id', 'notification_type', 'resource_identifier']) {
    assert(schema.includes(keyword), `Missing safe WeChat notification receipt field: ${keyword}`);
  }
  for (const keyword of ['notification_id', 'notification_type', 'resource_identifier', 'complete', 'fail']) {
    assert(notification.includes(keyword), `Missing WeChat notification receipt lifecycle: ${keyword}`);
  }
  assert(!combined.includes('receiver_phone:'), 'Refund ledger must not expose receiver_phone field');
  assert(/\^\[=\+\\-@\\t\\r\]/.test(service), 'CSV export must guard formula injection prefixes');
  assert(service.includes("? `'${text}` : text") || service.includes("? '\\''"), 'CSV export must prefix dangerous cells with apostrophe');
  assert(!combined.includes('wechat/refund') && !combined.includes('wx.requestPayment'), 'L28 must not call real WeChat refund/payment APIs');
  assert(!combined.includes('AUTO_REFUND_ENABLED = true'), 'L28 must not enable automatic refunds');
  assert(!combined.includes('AUTO_PAYOUT_ENABLED = ' + 'true'), 'L28 must not enable automatic payouts');
  assert(!combined.includes('AUTO_TAX_FILING_ENABLED = ' + 'true'), 'L28 must not enable automatic tax filing');

  assert(report.includes('l28Manifest') && report.includes('l28-refund-ledger-finance-check.md'), 'stage report manifest must include L28');
  ['退款台账', '财务对账', '人工退款', '不调用真实微信退款 API', 'CSV 防公式注入', 'receiver_phone_masked'].forEach((keyword) => assert(doc.includes(keyword), `Review doc missing keyword: ${keyword}`));

  scanComplianceFiles(requiredFiles.filter((file) => !file.includes('generate-stage-report')));
  console.log('Compliance scan passed.');
  console.log('L28 refund ledger finance check verification passed.');
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
