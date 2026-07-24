import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../apps/api/src/app.js';
import { scanComplianceFiles } from './lib/compliance-scan.js';

process.env.WECHAT_PAY_MODE = 'mock';
process.env.MOCK_WECHAT_PAY = 'true';
process.env.AUTO_PAYOUT_ENABLED = 'false';
process.env.AUTO_TAX_FILING_ENABLED = 'false';

const prisma = new PrismaClient();
const app = buildApp();
const prefix = `l17-5-${Date.now()}`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function json(response: Awaited<ReturnType<typeof app.inject>>) {
  const body = response.json() as { success: boolean; data: any; message: string };
  assert(response.statusCode < 300 && body.success, `API failed ${response.statusCode}: ${body.message}`);
  return body.data;
}

async function main() {
  const verifyStartedAt = new Date(Date.now() - 1000);
  const category = await prisma.category.create({ data: { name: `${prefix}-category`, sort_order: 1750, status: 'active' } });
  const community = await prisma.community.create({ data: { name: `${prefix}-community`, address: 'L17.5 验收社区', status: 'active' } });
  const pickupStore = await prisma.pickupStore.create({ data: { name: `${prefix}-pickup-store`, address: 'L17.5 自提点', phone: '13800017500', status: 'active' } });
  const user = await prisma.user.create({ data: { openid: `${prefix}-user`, nickname: 'L17.5普通购买用户', role: 'customer', status: 'active' } });
  const product = await prisma.product.create({ data: { name: `${prefix}-normal-product`, category_id: category.id, price_cents: 1234, cost_price_cents: 800, stock: 20, unit: '份', stock_unit: 'piece', sale_unit: '份', sale_spec_name: '1份装', stock_deduct_quantity: 1, status: 'active' } });

  const order = await json(await app.inject({ method: 'POST', url: '/api/orders/normal', payload: { product_id: product.id, user_id: user.id, client_request_id: `${prefix}-normal-order`, quantity: 3, pickup_store_id: pickupStore.id, community_id: community.id, receiver_name: '普通购买用户', receiver_phone: '13812345678' } }));
  assert(order.group_buy_id === null, 'normal order should not reference group buy');
  assert(order.product_id === product.id, 'normal order should reference product');
  assert(order.pay_amount_cents === product.price_cents * 3, 'normal order pay amount mismatch');
  assert(await prisma.commission.count({ where: { order_id: order.id } }) === 0, 'normal order should not create service reward');
  const unpaidProduct = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
  assert(unpaidProduct.stock === 20, 'unpaid normal order should not deduct stock');

  await json(await app.inject({ method: 'POST', url: '/api/payments/mock', payload: { order_id: order.id } }));
  const paidOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  const paidProduct = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
  assert(paidOrder.pay_status === 'paid', 'normal order should be paid by mock payment');
  assert(paidProduct.stock === 17, `normal order should deduct stock, got ${paidProduct.stock}`);
  const paymentLedger = await prisma.stockLedger.findFirst({ where: { product_id: product.id, source_type: 'order_payment', source_id: order.id, event_type: 'order_paid_deduct' } });
  assert(paymentLedger?.quantity === 3 && paymentLedger.quantity_delta === -3 && paymentLedger.stock_before === 20 && paymentLedger.stock_after === 17, 'normal order payment deduction ledger should record exact stock movement');
  assert(await prisma.commission.count({ where: { order_id: order.id } }) === 0, 'paid normal order should still not create service reward');

  const list = await json(await app.inject({ method: 'GET', url: '/api/orders' }));
  const listed = list.find((item: any) => item.id === order.id);
  assert(listed, 'normal order should be in order list');
  assert(listed.product?.name === product.name, 'normal order list should include product name');

  const afterSale = await json(await app.inject({ method: 'POST', url: '/api/after-sales', payload: { order_id: order.id, type: 'bad_quality', reason: '普通订单测试售后', description: 'L17.5 normal purchase after-sale verification', requested_refund_cents: 500 } }));
  await json(await app.inject({ method: 'POST', url: `/api/admin/after-sales/${afterSale.id}/review`, payload: { status: 'approved', resolution_type: 'partial_refund', approved_refund_cents: 500, responsibility: 'platform', admin_note: 'L17.5 normal purchase after-sale approved' } }));
  await json(await app.inject({ method: 'POST', url: `/api/admin/after-sales/${afterSale.id}/resolve`, payload: { resolution_type: 'partial_refund', approved_refund_cents: 500, admin_note: 'L17.5 normal purchase after-sale resolved' } }));
  const refundedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  assert(refundedOrder.refund_amount_cents > 0, 'normal order refund amount should update');
  assert(await prisma.commission.count({ where: { order_id: order.id } }) === 0, 'refunded normal order should not create service reward');

  const financeOrders = await json(await app.inject({ method: 'GET', url: '/api/admin/finance/reconciliation/orders?page_size=100' }));
  assert(financeOrders.items.some((item: any) => item.order_id === order.id), 'finance orders should include normal order');
  const financeRewards = await json(await app.inject({ method: 'GET', url: '/api/admin/finance/reconciliation/rewards' }));
  assert(!financeRewards.some((item: any) => item.order_id === order.id), 'finance rewards should not include normal order');
  const overview = await json(await app.inject({ method: 'GET', url: '/api/admin/operations/dashboard/overview' }));
  assert(overview.paid_amount >= order.pay_amount_cents, 'operations overview should include normal order paid amount');
  const productsQuery = new URLSearchParams({ from: verifyStartedAt.toISOString(), to: new Date(Date.now() + 1000).toISOString(), limit: '100' });
  const products = await json(await app.inject({ method: 'GET', url: `/api/admin/operations/dashboard/products?${productsQuery.toString()}` }));
  assert(products.some((item: any) => item.product_id === product.id), 'operations products should include normal order product');

  const complianceFiles = ['apps', 'packages', 'prisma', 'scripts'].flatMap((root) => {
    return execSync(`find ${root} -type f \\( -name '*.ts' -o -name '*.tsx' -o -name '*.prisma' -o -name '*.sql' \\) -not -path '*/reports/*' -not -name 'verify-l16-finance-reconciliation-local.ts' -not -name 'verify-l17-operations-dashboard-local.ts'`, { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  });
  scanComplianceFiles(complianceFiles);
  console.log('Compliance scan passed.');
  console.log('L17.5 normal purchase verification passed.');
}

main().finally(async () => { await app.close(); await prisma.$disconnect(); });
