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


function functionSlice(source: string, functionName: string) {
  const start = source.indexOf(`async function ${functionName}(`);
  assert(start >= 0, `${functionName} must exist`);
  const next = source.indexOf('\nasync function ', start + 1);
  return source.slice(start, next >= 0 ? next : source.length);
}

function assertTemplateMarker(fn: string, marker: string) {
  assert(!fn.includes(`console.log('${marker}`) && !fn.includes(`console.log("${marker}`), `${marker} must not be hardcoded`);
  assert(fn.includes('`' + marker + '=${'), `${marker} must be emitted from a template variable`);
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

const l44Function = functionSlice(e2e, 'runL44WithdrawalScenario');
assert(!l44Function.includes('const l44RuntimeEvidence'), 'L44 E2E must not use hardcoded evidence object');
for (const required of ['/api/leaders/me/withdrawals','/api/leaders/me/withdrawable-commissions','/api/admin/withdrawals/','Promise.all','Promise.allSettled']) assert(l44Function.includes(required), `L44 E2E must issue real request/concurrency: ${required}`);
for (const required of ['prisma.withdrawal','prisma.withdrawalCommission','prisma.commission','prisma.rewardLedger','prisma.adminAuditLog','prisma.businessEventLog','getAvailableRewardBalance']) assert(l44Function.includes(required), `L44 E2E must assert database state: ${required}`);
for (const marker of ['withdrawal_initial_available_balance_cents','withdrawal_reserved_amount_cents','withdrawal_balance_after_request_cents','withdrawal_same_request_concurrent_count','withdrawal_competing_request_success_count','withdrawal_link_count','withdrawal_ledger_mismatch_event_count','withdrawal_rejected_restore_ledger_count','withdrawal_balance_after_reject_cents','withdrawal_approve_reject_success_count','withdrawal_paid_status','withdrawal_balance_after_paid_cents','withdrawal_paid_ledger_count','withdrawal_repeat_no_duplicate']) assertTemplateMarker(l44Function, marker);
for (const section of ['=== L44 leader identity scenario ===','=== L44 withdrawal creation scenario ===','=== L44 same request concurrency scenario ===','=== L44 competing claim scenario ===','=== L44 ledger mismatch scenario ===','=== L44 rejection restore scenario ===','=== L44 approve reject race scenario ===','=== L44 paid scenario ===','=== L44 withdrawal authorization scenario ===']) assert(l44Function.includes(section), `L44 E2E must include section ${section}`);
for (const passed of ['l44_identity_scenario_passed','l44_creation_scenario_passed','l44_same_request_concurrency_passed','l44_competing_claim_passed','l44_ledger_mismatch_passed','l44_rejection_restore_passed','l44_approve_reject_race_passed','l44_paid_scenario_passed','l44_authorization_scenario_passed']) assert(l44Function.includes(passed), `L44 E2E must include pass marker ${passed}`);
for (const required of ['approvedRootEvents','approvedOrderEvents','rejectedRootEvents','rejectedOrderEvents','order_id: null','order_id: raceA.order.id','approvedAudits','rejectedAudits','raceTimelines',"raceFinal.status === 'approved'","raceFinal.status === 'rejected'"]) assert(l44Function.includes(required), `L44 approve/reject race must distinguish root/order/audit/timeline semantics: ${required}`);
assert(!l44Function.includes('approvedEvents === 1'), 'race test must not treat root and order events as one row');
assert(!l44Function.includes('rejectedEvents === 1'), 'race test must not treat root and order events as one row');
assert(e2e.includes('await runL44WithdrawalScenario();'), 'main must await runL44WithdrawalScenario');
assert(mini.includes('STORAGE_KEY') && mini.includes('wx.setStorageSync') && mini.includes('wx.removeStorageSync') && !mini.includes('commission_ids.join'), 'Miniapp request id is reusable and not based on full commission ids');
assert(admin.includes('RangePicker') && admin.includes('Drawer') && admin.includes('系统不会自动打款'), 'Admin workbench has filters/detail/manual copy');
const all = [route, admin, mini].join('\n');
assert(!/AUTO_PAYOUT_ENABLED\s*=\s*true|微信代付|支付宝转账|银行 API|payout SDK/i.test(all), 'no real payout integration');
console.log('L44 manual withdrawal review verifier passed.');
