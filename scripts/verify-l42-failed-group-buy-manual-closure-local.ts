import { readFileSync } from 'node:fs';
import { prisma } from '../apps/api/src/db.js';
import { buildApp } from '../apps/api/src/app.js';
import { deductInventoryForPaidOrder } from '../apps/api/src/modules/inventory/inventory-order-service.js';
import { closeFailedGroupBuy, closeFailedGroupBuyUnpaidOrders, confirmFailedGroupBuyRefundHandled, getFailedGroupBuyClosureSummary, listFailedGroupBuyPendingRefundOrders, markGroupBuyFailed } from '../apps/api/src/modules/group-buy/group-buy-expiry-service.js';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function read(path: string): string { return readFileSync(path, 'utf8'); }
function assertSafeL42Payload(payload: unknown, label: string) {
  const serialized = JSON.stringify(payload);
  for (const forbidden of ['\"receiver_phone\"', '\"receiver_address\"', '\"cost_price_cents\"', '\"password_hash\"', '\"raw_notify\"', '\"commission_value\"', '\"commission_type\"', '\"stock_deduct_quantity\"']) {
    assert(!serialized.includes(forbidden), `${label} leaked forbidden field ${forbidden}`);
  }
}

async function main() {
  const service = read('apps/api/src/modules/group-buy/group-buy-expiry-service.ts');
  const routes = read('apps/api/src/routes/group-buys.ts');
  const adminUi = read('apps/admin/src/App.tsx');
  for (const keyword of ['getFailedGroupBuyClosureSummary', 'markGroupBuyFailed', 'closeFailedGroupBuyUnpaidOrders', 'listFailedGroupBuyPendingRefundOrders', 'confirmFailedGroupBuyRefundHandled', 'closeFailedGroupBuy']) assert(service.includes(keyword), `missing service keyword ${keyword}`);
  for (const keyword of ['toSafeClosureOrder', 'receiver_phone_masked', 'receiver_address_masked', 'toSafeClosureRefund']) assert(service.includes(keyword), `missing safe response mapper keyword ${keyword}`);
  const confirmFunction = service.slice(service.indexOf('export async function confirmFailedGroupBuyRefundHandled'), service.indexOf('export async function closeFailedGroupBuy'));
  assert(!/order\s*:\s*updatedOrder/.test(confirmFunction), 'confirm-refund must not directly return Prisma Order');
  assert(!/refund\s*(,|})/.test(confirmFunction.replace('toSafeClosureRefund(refund)', 'safeRefund')), 'confirm-refund must not directly return Prisma Refund');
  for (const path of ['/api/admin/group-buys/:id/closure-summary', '/api/admin/group-buys/:id/mark-failed', '/api/admin/group-buys/:id/close-unpaid-orders', '/api/admin/group-buys/:id/manual-refund-orders', '/api/admin/group-buys/:groupBuyId/orders/:orderId/confirm-refund', '/api/admin/group-buys/:id/close']) assert(routes.includes(path), `missing route ${path}`);
  assert(adminUi.includes('失败团购人工关闭工作台'), 'Admin workbench copy missing');
  assert(!read('prisma/schema.prisma').includes(`parent_${'leader'}_id`) && !read('prisma/schema.prisma').includes(`up${'line'}_id`), 'must not add multilevel fields');
  assert(!service.includes('L43'), 'must not develop L43');

  const prefix = `l42-${Date.now()}`;
  const adminId = `l42-admin-${Date.now()}`;
  const admin = await prisma.adminUser.create({ data: { id: adminId, username: `${adminId}-user`, password_hash: 'l42-test-placeholder-not-for-login', role: 'super_admin', status: 'active' } });
  const inactiveAdmin = await prisma.adminUser.create({ data: { id: `${adminId}-inactive`, username: `${adminId}-inactive-user`, password_hash: 'l42-test-placeholder-not-for-login', role: 'super_admin', status: 'inactive' } });
  const category = await prisma.category.create({ data: { name: `${prefix}-category` } });
  const community = await prisma.community.create({ data: { name: `${prefix}-community`, address: 'L42 community', status: 'active' } });
  const leader = await prisma.user.create({ data: { openid: `${prefix}-leader`, nickname: 'L42 leader', role: 'leader', status: 'active' } });
  const user = await prisma.user.create({ data: { openid: `${prefix}-user`, nickname: 'L42 user', role: 'customer', status: 'active' } });
  const product = await prisma.product.create({ data: { name: `${prefix}-product`, category_id: category.id, price_cents: 1000, cost_price_cents: 500, stock: 10, unit: '份', stock_unit: '份', sale_unit: '份', stock_deduct_quantity: 1, status: 'active', is_group_enabled: true } });
  const groupBuy = await prisma.groupBuy.create({ data: { product_id: product.id, leader_user_id: leader.id, community_id: community.id, min_people: 3, min_quantity: 3, price_cents: 1000, start_time: new Date(Date.now() - 7200_000), end_time: new Date(Date.now() - 3600_000), pickup_time: new Date(Date.now() + 86400_000), status: 'pending' } });
  const paidOrder = await prisma.order.create({ data: { order_no: `${prefix}-paid`, user_id: user.id, group_buy_id: groupBuy.id, product_id: product.id, leader_user_id: leader.id, community_id: community.id, total_amount_cents: 1000, product_amount_cents: 1000, pay_amount_cents: 1000, quantity: 1, pay_status: 'paid', order_status: 'paid', refund_status: 'none', paid_at: new Date(), receiver_name: 'L42', receiver_phone: '13800000000' } });
  const unpaidOrder = await prisma.order.create({ data: { order_no: `${prefix}-unpaid`, user_id: user.id, group_buy_id: groupBuy.id, product_id: product.id, leader_user_id: leader.id, community_id: community.id, total_amount_cents: 1000, product_amount_cents: 1000, pay_amount_cents: 1000, quantity: 1, pay_status: 'unpaid', order_status: 'unpaid', refund_status: 'none', receiver_name: 'L42', receiver_phone: '13800000000' } });
  await prisma.$transaction((tx) => deductInventoryForPaidOrder(tx, { order: paidOrder }));
  const stockAfterPaid = (await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock;
  let inactiveRejected = false;
  try {
    await markGroupBuyFailed({ group_buy_id: groupBuy.id, reason: 'inactive admin should fail', admin_meta: { admin_user_id: inactiveAdmin.id } });
  } catch (error) {
    inactiveRejected = error instanceof Error && error.message.includes('管理员不存在或已停用');
  }
  assert(inactiveRejected, 'inactive AdminUser must be rejected with business error');
  assert((await prisma.groupBuy.findUniqueOrThrow({ where: { id: groupBuy.id } })).status === 'pending', 'inactive admin must not change group buy status');
  assert(await prisma.adminAuditLog.count({ where: { admin_user_id: inactiveAdmin.id } }) === 0, 'inactive admin must not write audit logs');
  assert((await prisma.order.findUniqueOrThrow({ where: { id: unpaidOrder.id } })).order_status === 'unpaid', 'inactive admin must not close unpaid orders');
  assert(await prisma.refund.count({ where: { order_id: paidOrder.id } }) === 0, 'inactive admin must not create refund confirmation');
  assert((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock === stockAfterPaid, 'inactive admin must not change inventory');
  let missingAdminRejected = false;
  try {
    await markGroupBuyFailed({ group_buy_id: groupBuy.id, reason: 'missing admin should fail', admin_meta: { admin_user_id: `${admin.id}-missing` } });
  } catch (error) {
    missingAdminRejected = error instanceof Error && error.message.includes('管理员不存在或已停用');
  }
  assert(missingAdminRejected, 'missing AdminUser must be rejected with business error');

  const failed = await markGroupBuyFailed({ group_buy_id: groupBuy.id, reason: 'L42 人工确认未达成团条件', admin_meta: { admin_user_id: admin.id } });
  assertSafeL42Payload(failed, 'mark failed response');
  assert(failed.status === 'failed' && failed.applied, 'pending group buy must become failed');
  const failedAgain = await markGroupBuyFailed({ group_buy_id: groupBuy.id, reason: 'L42 repeat', admin_meta: { admin_user_id: admin.id } });
  assert(failedAgain.idempotent, 'repeated mark failed must be idempotent');
  assert(await prisma.refund.count({ where: { order_id: paidOrder.id } }) === 0, 'mark failed must not create refund');
  assert((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock === stockAfterPaid, 'mark failed must not restore inventory');

  const successGroup = await prisma.groupBuy.create({ data: { product_id: product.id, leader_user_id: leader.id, community_id: community.id, min_people: 1, min_quantity: 1, price_cents: 1000, start_time: new Date(Date.now() - 7200_000), end_time: new Date(Date.now() - 3600_000), pickup_time: new Date(Date.now() + 86400_000), status: 'success' } });
  let successRejected = false;
  try { await markGroupBuyFailed({ group_buy_id: successGroup.id, reason: 'should reject', admin_meta: { admin_user_id: admin.id } }); } catch { successRejected = true; }
  assert(successRejected, 'success group buy cannot be failed');

  const closeUnpaid = await closeFailedGroupBuyUnpaidOrders({ group_buy_id: groupBuy.id, admin_meta: { admin_user_id: admin.id } });
  assertSafeL42Payload(closeUnpaid, 'close unpaid response');
  assert(closeUnpaid.closed_count === 1 && closeUnpaid.matched_count === 1, 'unpaid order must close once');
  const unpaidAfter = await prisma.order.findUniqueOrThrow({ where: { id: unpaidOrder.id } });
  assert(unpaidAfter.order_status === 'closed' && unpaidAfter.pay_status === 'unpaid', 'unpaid close must keep pay_status unpaid');
  assert(await prisma.refund.count({ where: { order_id: unpaidOrder.id } }) === 0, 'unpaid close must not create refund');
  assert(await prisma.stockLedger.count({ where: { order_id: unpaidOrder.id } }) === 0, 'unpaid close must not create stock ledger');

  const list = await listFailedGroupBuyPendingRefundOrders(groupBuy.id);
  assertSafeL42Payload(list, 'manual refund orders response');
  assert(list.summary.pending_refund_orders === 1 && list.items[0]?.order_id === paidOrder.id, 'paid order must enter pending manual refund list');
  assert(!JSON.stringify(list).includes('13800000000') && !JSON.stringify(list).includes('password_hash') && !JSON.stringify(list).includes('cost_price'), 'manual refund list must not leak sensitive fields');
  const pendingRefund = await prisma.refund.create({ data: { order_id: paidOrder.id, out_refund_no: `${prefix}-pending-refund`, client_refund_id: `${prefix}-pending-refund`, refund_amount_cents: 1000, product_refund_amount_cents: 1000, delivery_refund_amount_cents: 0, reason: 'L42 pending', status: 'pending' } });
  let pendingRejected = false;
  try { await confirmFailedGroupBuyRefundHandled({ group_buy_id: groupBuy.id, order_id: paidOrder.id, refund_id: pendingRefund.id, admin_meta: { admin_user_id: admin.id } }); } catch { pendingRejected = true; }
  assert(pendingRejected, 'pending refund cannot be confirmed');
  const blocked = await closeFailedGroupBuy({ group_buy_id: groupBuy.id, admin_meta: { admin_user_id: admin.id } });
  assertSafeL42Payload(blocked, 'blocked final close response');
  assert(!blocked.applied && 'blockers' in blocked, 'pending refund must block final close');

  const successRefund = await prisma.refund.create({ data: { order_id: paidOrder.id, out_refund_no: `${prefix}-success-refund`, client_refund_id: `${prefix}-success-refund`, refund_amount_cents: 1000, product_refund_amount_cents: 1000, delivery_refund_amount_cents: 0, reason: 'L42 success', status: 'success', processed_at: new Date() } });
  const confirmedRefund = await confirmFailedGroupBuyRefundHandled({ group_buy_id: groupBuy.id, order_id: paidOrder.id, refund_id: successRefund.id, admin_meta: { admin_user_id: admin.id } });
  const repeatedConfirmedRefund = await confirmFailedGroupBuyRefundHandled({ group_buy_id: groupBuy.id, order_id: paidOrder.id, refund_id: successRefund.id, admin_meta: { admin_user_id: admin.id } });
  assertSafeL42Payload(confirmedRefund, 'confirm refund response');
  assertSafeL42Payload(repeatedConfirmedRefund, 'repeat confirm refund response');
  assert(confirmedRefund.order.order_id === paidOrder.id && confirmedRefund.refund.refund_id === successRefund.id && confirmedRefund.inventory, 'confirm refund response must include safe order/refund/inventory');
  assert(repeatedConfirmedRefund.idempotent === true && repeatedConfirmedRefund.order.order_id === paidOrder.id && repeatedConfirmedRefund.refund.refund_id === successRefund.id && repeatedConfirmedRefund.inventory, 'repeat confirm refund response must be idempotent and safe');
  assert((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock === 10, 'refund success must restore inventory once through L41');
  assert(await prisma.stockLedger.count({ where: { refund_id: successRefund.id, event_type: 'group_failed_refund_restore' } }) === 1, 'duplicate confirm must not duplicate restore ledger');
  await prisma.refund.update({ where: { id: pendingRefund.id }, data: { status: 'failed' } });
  const summary = await getFailedGroupBuyClosureSummary(groupBuy.id);
  assertSafeL42Payload(summary, 'closure summary response');
  assert(summary.closable && summary.pending_refund_amount_cents === 0 && summary.inventory_remaining_restorable_quantity === 0, 'closure summary must be closable after收口');
  const closed = await closeFailedGroupBuy({ group_buy_id: groupBuy.id, admin_meta: { admin_user_id: admin.id } });
  assertSafeL42Payload(closed, 'final close response');
  assert(closed.applied && closed.status === 'closed', 'final close must set closed');
  const closedAgain = await closeFailedGroupBuy({ group_buy_id: groupBuy.id, admin_meta: { admin_user_id: admin.id } });
  assertSafeL42Payload(closedAgain, 'repeat final close response');
  assert(closedAgain.idempotent && closedAgain.status === 'closed', 'repeat final close idempotent');

  const inactiveAdminId = inactiveAdmin.id;
  const scopedAdminId = `${prefix}-scoped-admin`;
  await prisma.adminUser.create({ data: { id: scopedAdminId, username: `${prefix}-scoped`, password_hash: 'placeholder', role: 'store_manager', status: 'active' } });
  const app = buildApp();
  const unauthorized = await app.inject({ method: 'POST', url: `/api/admin/group-buys/${groupBuy.id}/mark-failed`, payload: { reason: 'no admin' } });
  assert(unauthorized.statusCode === 401, 'missing admin must be 401');
  const inactive = await app.inject({ method: 'POST', url: `/api/admin/group-buys/${groupBuy.id}/mark-failed`, headers: { 'x-admin-role': 'super_admin', 'x-admin-user-id': inactiveAdminId }, payload: { reason: 'inactive' } });
  assert(inactive.statusCode === 401 || inactive.statusCode === 403, 'inactive AdminUser must be rejected');
  const scoped = await app.inject({ method: 'POST', url: `/api/admin/group-buys/${successGroup.id}/mark-failed`, headers: { 'x-admin-role': 'store_manager', 'x-admin-user-id': scopedAdminId, 'x-admin-community-id': `${prefix}-other-community` }, payload: { reason: 'scope denied' } });
  assert(scoped.statusCode === 403, 'cross-community data scope must be 403');
  await app.close();
  const auditLogs = await prisma.adminAuditLog.findMany({ where: { admin_user_id: admin.id } });
  assert(auditLogs.length > 0, 'L42 admin audit logs missing');
  const auditActions = auditLogs.map((log) => log.action);
  for (const actionKeyword of ['group_buy_mark_failed', 'group_buy_close_unpaid', 'group_buy_refund_confirm', 'group_buy_final_close']) {
    assert(auditActions.some((action) => action.includes(actionKeyword)), `L42 admin audit action missing: ${actionKeyword}`);
  }
  assert(read('docs/plans/next-stage-development-plan.md').includes('L43') && !service.includes('reward ledger'), 'L43 must remain undeveloped');
  console.log('L42 failed group buy manual closure verification passed.');
}

main().finally(async () => prisma.$disconnect());
