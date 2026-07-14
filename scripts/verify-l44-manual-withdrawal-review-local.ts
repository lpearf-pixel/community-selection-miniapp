import { readFileSync, existsSync } from 'node:fs';
function read(p:string){return readFileSync(p,'utf8')}
function assert(c:unknown,m:string):asserts c{if(!c)throw new Error(m)}
const schema=read('prisma/schema.prisma');
const route=read('apps/api/src/routes/withdrawals.ts');
const e2e=read('scripts/verify-docker-api-e2e-local.ts');
const mini=read('apps/miniapp/pages/leader/withdrawals/index.js');
const admin=read('apps/admin/src/pages/withdrawals/WithdrawalReviewPage.tsx');
assert(schema.includes('model WithdrawalCommission'), 'WithdrawalCommission model exists');
assert(schema.includes('commission_links') && schema.includes('withdrawal_links'), 'Withdrawal/Commission relation arrays exist');
assert(existsSync('prisma/migrations/20260714000200_l44_withdrawal_commission_links/migration.sql'), 'WithdrawalCommission follow-up migration exists');
for (const required of ['getCommissionAvailableNet', 'persistLedgerMismatch', 'withdrawal_ledger_mismatch', 'PrismaClientKnownRequestError', 'P2002', 'withdrawalCommission.createMany', 'skipDuplicates', 'updateMany({ where: { id, status: "pending"', 'updateMany({ where: { id, status: "approved"', 'requireWithdrawalDataScope', 'GET /api/admin/withdrawals/:id']) {
  assert(route.includes(required), `route includes ${required}`);
}
assert(route.includes('reply.code((error as { statusCode?: number }).statusCode ?? 400)'), 'route catch preserves status codes');
assert(route.includes('commission_links') && route.includes('linksInScope'), 'admin list/detail use persistent links for data scope');
assert(route.includes('requireAdminPermission("finance.view")'), 'tax records keep finance.view semantics');
for (const marker of ['withdrawal_same_request_concurrent_count=1','withdrawal_competing_request_success_count=1','withdrawal_link_count=2','withdrawal_ledger_mismatch_event_count=1','withdrawal_approve_reject_success_count=1','scoped_finance_list_filtered']) assert(e2e.includes(marker), `Docker E2E marker ${marker}`);
assert(e2e.includes('l44-withdrawal-e2e-') && e2e.includes('WithdrawalCommission') && e2e.includes('withdrawal_negative_no_db_mutation'), 'Docker E2E has L44 fixture/db assertions');
assert(!/console\.log\([\s\S]*L44 manual withdrawal review[\s\S]*main\(\)\.catch/.test(e2e), 'markers are not after main catch');
assert(mini.includes('STORAGE_KEY') && mini.includes('wx.setStorageSync') && mini.includes('wx.removeStorageSync') && !mini.includes('commission_ids.join'), 'Miniapp request id is reusable and not based on full commission ids');
assert(admin.includes('RangePicker') && admin.includes('Drawer') && admin.includes('系统不会自动打款'), 'Admin workbench has filters/detail/manual copy');
const all=[route,admin,mini].join('\n');
assert(!/AUTO_PAYOUT_ENABLED\s*=\s*true|微信代付|支付宝转账|银行 API|payout SDK/i.test(all), 'no real payout integration');
console.log('L44 manual withdrawal review verifier passed.');
