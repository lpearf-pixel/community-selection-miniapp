import { readFileSync, existsSync } from 'node:fs';

function read(path: string) { return readFileSync(path, 'utf8'); }
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

function allIndexes(source: string, needle: string) {
  const indexes: number[] = [];
  let offset = 0;
  while (offset < source.length) {
    const index = source.indexOf(needle, offset);
    if (index < 0) break;
    indexes.push(index);
    offset = index + needle.length;
  }
  return indexes;
}

function routeBlock(source: string, method: 'get' | 'post', path: string) {
  const doubleQuotedPath = `"${path}"`;
  const singleQuotedPath = `'${path}'`;
  const pathIndexCandidates = [...allIndexes(source, doubleQuotedPath), ...allIndexes(source, singleQuotedPath)].sort((a, b) => a - b);
  assert(pathIndexCandidates.length > 0, `route path must exist: ${method.toUpperCase()} ${path}`);
  const methodMarker = `app.${method}(`;
  for (const pathIndex of pathIndexCandidates) {
    const methodIndex = source.lastIndexOf(methodMarker, pathIndex);
    if (methodIndex < 0) continue;
    const between = source.slice(methodIndex, pathIndex);
    if (/app\.(get|post|put|patch|delete)\(/.test(between.replace(methodMarker, ''))) continue;
    const nextRouteIndexes = [
      source.indexOf('\n  app.get(', pathIndex + 1),
      source.indexOf('\n  app.post(', pathIndex + 1),
      source.indexOf('\n  app.put(', pathIndex + 1),
      source.indexOf('\n  app.patch(', pathIndex + 1),
      source.indexOf('\n  app.delete(', pathIndex + 1)
    ].filter((index) => index >= 0);
    const end = nextRouteIndexes.length > 0 ? Math.min(...nextRouteIndexes) : source.length;
    return source.slice(methodIndex, end);
  }
  throw new Error(`route method must exist: ${method.toUpperCase()} ${path}`);
}

const schema = read('prisma/schema.prisma');
const route = read('apps/api/src/routes/withdrawals.ts');
const e2e = read('scripts/verify-docker-api-e2e-local.ts');
const mini = read('apps/miniapp/pages/leader/withdrawals/index.js');
const admin = read('apps/admin/src/pages/withdrawals/WithdrawalReviewPage.tsx');

assert(schema.includes('model WithdrawalCommission'), 'WithdrawalCommission model exists');
assert(schema.includes('commission_links') && schema.includes('withdrawal_links'), 'Withdrawal/Commission relation arrays exist');
assert(existsSync('prisma/migrations/20260714000200_l44_withdrawal_commission_links/migration.sql'), 'WithdrawalCommission follow-up migration exists');

for (const required of ['getCommissionAvailableNet', 'persistLedgerMismatch', 'withdrawal_ledger_mismatch', 'PrismaClientKnownRequestError', 'P2002', 'withdrawalCommission.createMany', 'skipDuplicates', 'updateMany({ where: { id, status: "pending"', 'updateMany({ where: { id, status: "approved"', 'requireWithdrawalDataScope']) {
  assert(route.includes(required), `route includes ${required}`);
}

const leaderWithdrawableRoute = routeBlock(route, 'get', '/api/leaders/me/withdrawable-commissions');
assert(leaderWithdrawableRoute.includes('resolveCurrentLeader(request)'), 'Leader withdrawable commissions must use current identity');
assert(leaderWithdrawableRoute.includes('getAvailableRewardBalance'), 'Leader withdrawable commissions must use RewardLedger balance');

const leaderWithdrawalListRoute = routeBlock(route, 'get', '/api/leaders/me/withdrawals');
assert(leaderWithdrawalListRoute.includes('resolveCurrentLeader(request)'), 'Leader withdrawal list must use current identity');
assert(leaderWithdrawalListRoute.includes('withdrawalCommission'), 'Leader withdrawal list must count persistent commission links');

const leaderWithdrawalDetailRoute = routeBlock(route, 'get', '/api/leaders/me/withdrawals/:id');
assert(leaderWithdrawalDetailRoute.includes('resolveCurrentLeader(request)'), 'Leader withdrawal detail must use current identity');
assert(leaderWithdrawalDetailRoute.includes('leader_user_id: leader.id'), 'Leader withdrawal detail must be scoped to current leader');

const createWithdrawalRoute = routeBlock(route, 'post', '/api/leaders/me/withdrawals');
assert(createWithdrawalRoute.includes('resolveCurrentLeader(request)'), 'Leader withdrawal creation must use current identity');
assert(createWithdrawalRoute.includes('client_request_id'), 'Leader withdrawal creation must require client_request_id');
assert(createWithdrawalRoute.includes('getCommissionAvailableNet'), 'Leader withdrawal creation must validate each commission ledger net');
assert(createWithdrawalRoute.includes('withdrawalCommission.createMany'), 'Leader withdrawal creation must persist commission links');
assert(createWithdrawalRoute.includes('PrismaClientKnownRequestError') && createWithdrawalRoute.includes('P2002'), 'Leader withdrawal creation must handle client_request_id unique races');
assert(createWithdrawalRoute.includes('withdrawal_reserved'), 'Leader withdrawal creation must reserve available ledger balance');

const adminWithdrawalListRoute = routeBlock(route, 'get', '/api/admin/withdrawals');
assert(adminWithdrawalListRoute.includes('requireAdminPermission("withdrawal.view")'), 'Admin withdrawal list must require withdrawal.view');
assert(adminWithdrawalListRoute.includes('request.query as AdminWithdrawalQuery'), 'Admin withdrawal list must read query');
assert(adminWithdrawalListRoute.includes('commission_links'), 'Admin withdrawal list must load persistent commission links');
assert(adminWithdrawalListRoute.includes('linksInScope'), 'Admin withdrawal list must apply data scope');
assert(adminWithdrawalListRoute.includes('total'), 'Admin withdrawal list must return filtered total');

const adminWithdrawalDetailRoute = routeBlock(route, 'get', '/api/admin/withdrawals/:id');
assert(adminWithdrawalDetailRoute.includes('requireAdminPermission("withdrawal.view")'), 'Admin withdrawal detail must require withdrawal.view');
assert(adminWithdrawalDetailRoute.includes('requireWithdrawalDataScope(id, request)'), 'Admin withdrawal detail must enforce data scope');
assert(adminWithdrawalDetailRoute.includes('withdrawalCommission') || adminWithdrawalDetailRoute.includes('commission_links'), 'Admin withdrawal detail must load persistent commission links');
assert(adminWithdrawalDetailRoute.includes('rewardLedger.findMany'), 'Admin withdrawal detail must include reward ledger summary');
assert(adminWithdrawalDetailRoute.includes('adminAuditLog.findMany'), 'Admin withdrawal detail must include admin audit summary');

const approveRoute = routeBlock(route, 'post', '/api/admin/withdrawals/:id/approve');
assert(approveRoute.includes('requireAdminPermission("withdrawal.manage")'), 'Approve route must require withdrawal.manage');
assert(approveRoute.includes('requireWithdrawalDataScope(id, request)'), 'Approve route must enforce data scope');
assert(approveRoute.includes('updateMany({ where: { id, status: "pending"'), 'Approve route must conditionally claim pending status');
assert(approveRoute.includes('idempotent: true'), 'Approve route must be idempotent for already-approved state');

const rejectRoute = routeBlock(route, 'post', '/api/admin/withdrawals/:id/reject');
assert(rejectRoute.includes('requireAdminPermission("withdrawal.manage")'), 'Reject route must require withdrawal.manage');
assert(rejectRoute.includes('requireWithdrawalDataScope(id, request)'), 'Reject route must enforce data scope');
assert(rejectRoute.includes('updateMany({ where: { id, status: "pending"'), 'Reject route must conditionally claim pending status');
assert(rejectRoute.includes('withdrawal_rejected_restore'), 'Reject route must restore reserved ledger balance once');
assert(rejectRoute.includes('withdrawalCommission') || rejectRoute.includes('getWithdrawalLinks'), 'Reject route must use persistent links');

const markPaidRoute = routeBlock(route, 'post', '/api/admin/withdrawals/:id/mark-paid');
assert(markPaidRoute.includes('requireAdminPermission("withdrawal.manage")'), 'Mark-paid route must require withdrawal.manage');
assert(markPaidRoute.includes('requireWithdrawalDataScope(id, request)'), 'Mark-paid route must enforce data scope');
assert(markPaidRoute.includes('updateMany({ where: { id, status: "approved"'), 'Mark-paid route must conditionally claim approved status');
assert(markPaidRoute.includes('withdrawal_paid'), 'Mark-paid route must write paid audit ledger');
assert(markPaidRoute.includes('affects_available_balance: false'), 'Mark-paid ledger must not affect available balance');

assert(route.includes('reply.code((error as { statusCode?: number }).statusCode ?? 400)'), 'route catch preserves status codes');
assert(route.includes('commission_links') && route.includes('linksInScope'), 'admin list/detail use persistent links for data scope');
assert(route.includes('requireAdminPermission("finance.view")'), 'tax records keep finance.view semantics');

for (const marker of ['withdrawal_same_request_concurrent_count=1','withdrawal_competing_request_success_count=1','withdrawal_link_count=2','withdrawal_ledger_mismatch_event_count=1','withdrawal_approve_reject_success_count=1','scoped_finance_list_filtered']) assert(e2e.includes(marker), `Docker E2E marker ${marker}`);
assert(e2e.includes('l44-withdrawal-e2e-') && e2e.includes('WithdrawalCommission') && e2e.includes('withdrawal_negative_no_db_mutation'), 'Docker E2E has L44 fixture/db assertions');
const l44MarkerIndex = e2e.indexOf('L44 manual withdrawal review:');
const mainCatchIndex = e2e.indexOf('main().catch');
assert(l44MarkerIndex >= 0 && mainCatchIndex >= 0 && l44MarkerIndex < mainCatchIndex, 'markers are emitted from main execution path before main catch');
assert(mini.includes('STORAGE_KEY') && mini.includes('wx.setStorageSync') && mini.includes('wx.removeStorageSync') && !mini.includes('commission_ids.join'), 'Miniapp request id is reusable and not based on full commission ids');
assert(admin.includes('RangePicker') && admin.includes('Drawer') && admin.includes('系统不会自动打款'), 'Admin workbench has filters/detail/manual copy');
const all = [route, admin, mini].join('\n');
assert(!/AUTO_PAYOUT_ENABLED\s*=\s*true|微信代付|支付宝转账|银行 API|payout SDK/i.test(all), 'no real payout integration');
console.log('L44 manual withdrawal review verifier passed.');
