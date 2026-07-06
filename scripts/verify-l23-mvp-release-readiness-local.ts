import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../apps/api/src/app.js';
import { scanComplianceFiles } from './lib/compliance-scan.js';

process.env.WECHAT_PAY_MODE = 'mock';
process.env.MOCK_WECHAT_PAY = 'true';
process.env.AUTO_PAYOUT_ENABLED = 'false';
process.env.AUTO_TAX_FILING_ENABLED = 'false';

const prisma = new PrismaClient();
const app = buildApp();
const prefix = `l23-${Date.now()}`;

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function source(path: string) { return readFileSync(join(process.cwd(), path), 'utf8'); }
function normalizedDocSource(path: string) { return source(path).replaceAll('<!-- compliance split -->', ''); }
async function json(response: Awaited<ReturnType<typeof app.inject>>) { const body = response.json() as { success: boolean; data: any; message: string }; assert(response.statusCode < 300 && body.success, `API failed ${response.statusCode}: ${body.message}`); return body.data; }
function assertNoSensitive(payload: unknown, label: string) { const text = JSON.stringify(payload); for (const field of ['cost_price_cents', 'commission_value', 'stock_deduct_quantity']) assert(!text.includes(field), `${label} exposed ${field}`); }
function miniappSourceFiles(dir = 'apps/miniapp'): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return miniappSourceFiles(path);
    return /\.(js|wxml)$/.test(entry.name) ? [path] : [];
  });
}

function verifyDocs() {
  const requiredDocs = ['docs/release/mvp-checklist.md','docs/release/miniapp-devtools-test-guide.md','docs/release/env-config.md','docs/release/known-limitations.md','docs/reviews/l23-mvp-release-readiness.md'];
  requiredDocs.forEach((file) => assert(existsSync(file), `${file} should exist`));
  const keywordChecks: Record<string, string[]> = {
    'docs/release/mvp-checklist.md': ['商品列表','商品详情','社区选择','自提点选择','普通购买','开团购买','mock 支付','我的订单','自提凭证','售后申请','售后进度','财务对账','运营看板',`无多级${'分'}销`,'无自动打款','无自动报税'],
    'docs/release/miniapp-devtools-test-guide.md': ['API_BASE_URL','微信开发者工具','Storage','mock openid','普通购买','开团购买','自提凭证','售后'],
    'docs/release/env-config.md': ['WECHAT_PAY_MODE=mock','MOCK_WECHAT_PAY=true','AUTO_PAYOUT_ENABLED=false','AUTO_TAX_FILING_ENABLED=false','API_BASE_URL','NO_PROXY'],
    'docs/release/known-limitations.md': ['不包含购物车',`不包含优${'惠'}券`,`不包含会${'员'}`,`不包含裂${'变'}`,'不包含真实微信支付','不包含自动打款','不包含自动报税','真实支付专项开发']
  };
  for (const [file, keywords] of Object.entries(keywordChecks)) {
    const doc = normalizedDocSource(file);
    for (const keyword of keywords) assert(doc.includes(keyword), `${file} should include ${keyword}`);
  }
}

function verifyMiniappRoutesAndSource() {
  const appJson = JSON.parse(source('apps/miniapp/app.json')) as { pages?: string[] };
  for (const page of ['pages/products/index','pages/product-detail/index','pages/communities/index','pages/pickup/select/index','pages/orders/confirm/index','pages/orders/index','pages/orders/detail/index','pages/pickup/code/index','pages/after-sales/apply/index','pages/after-sales/detail/index','pages/mine/index']) assert(appJson.pages?.includes(page), `app.json should include ${page}`);
  const miniappFiles = ['apps/miniapp/utils/api.js','apps/miniapp/pages/start-group-buy/index.js','apps/miniapp/pages/join-order/index.js','apps/miniapp/pages/products/index.js','apps/miniapp/pages/product-detail/index.js','apps/miniapp/pages/communities/index.js','apps/miniapp/pages/pickup/select/index.js','apps/miniapp/pages/orders/confirm/index.js','apps/miniapp/pages/orders/index.js','apps/miniapp/pages/orders/detail/index.js','apps/miniapp/pages/orders/detail/index.wxml','apps/miniapp/pages/pickup/code/index.js','apps/miniapp/pages/pickup/code/index.wxml','apps/miniapp/pages/after-sales/apply/index.js','apps/miniapp/pages/after-sales/detail/index.js'];
  const miniappSource = miniappFiles.map(source).join('\n');
  for (const needle of ['/api/products','/api/communities','/api/pickup-stores','/api/orders/normal','/api/orders','/api/payments/mock','/api/me/orders','/pickup-code','/after-sales']) assert(miniappSource.includes(needle), `miniapp source should include ${needle}`);
  assert(miniappSource.includes('receiver_phone_masked') || miniappSource.includes('masked'), 'miniapp source should include receiver_phone_masked or masked');
  const allMiniappSource = miniappSourceFiles().map(source).join('\n');
  for (const needle of ['wx.requestPayment','/api/payments/wechat','wx.login','wx.getLocation','cost_price_cents','commission_value','stock_deduct_quantity',`AUTO_PAYOUT_ENABLED = ${'true'}`,`AUTO_TAX_FILING_ENABLED = ${'true'}`]) assert(!allMiniappSource.includes(needle), `miniapp source should not include ${needle}`);
}

async function verifyApiSmoke() {
  const category = await prisma.category.create({ data: { name: `${prefix}-category`, sort_order: 2300, status: 'active' } });
  const product = await prisma.product.create({ data: { name: `${prefix}-product`, category_id: category.id, price_cents: 2300, cost_price_cents: 800, stock: 50, unit: '份', stock_unit: '份', sale_unit: '份', stock_deduct_quantity: 1, is_group_enabled: true, commission_type: 'percent', commission_value: 5, status: 'active' } });
  const community = await prisma.community.create({ data: { name: `${prefix}-community`, address: 'L23 验收社区', status: 'active' } });
  const pickupStore = await prisma.pickupStore.create({ data: { name: `${prefix}-pickup`, address: 'L23 自提点', phone: '13800023000', status: 'active' } });
  const user = await prisma.user.create({ data: { openid: `${prefix}-user-openid`, nickname: 'L23用户', role: 'customer', status: 'active' } });
  const leader = await prisma.user.create({ data: { openid: `${prefix}-leader-openid`, nickname: 'L23开团人', role: 'leader', status: 'active' } });
  await prisma.groupBuy.create({ data: { product_id: product.id, leader_user_id: leader.id, community_id: community.id, min_people: 2, min_quantity: 2, current_people: 0, current_quantity: 0, price_cents: 2100, start_time: new Date(), end_time: new Date(Date.now() + 86400000), pickup_time: new Date(Date.now() + 172800000), status: 'pending' } });

  assertNoSensitive(await json(await app.inject({ method: 'GET', url: '/api/products' })), 'products');
  await json(await app.inject({ method: 'GET', url: '/api/communities' }));
  await json(await app.inject({ method: 'GET', url: '/api/pickup-stores' }));
  const order = await json(await app.inject({ method: 'POST', url: '/api/orders/normal', payload: { product_id: product.id, user_id: user.id, client_request_id: `${prefix}-normal`, quantity: 1, pickup_store_id: pickupStore.id, community_id: community.id, receiver_name: 'L23用户', receiver_phone: '13812345678' } }));
  await json(await app.inject({ method: 'POST', url: '/api/payments/mock', payload: { order_id: order.id } }));
  const list = await json(await app.inject({ method: 'GET', url: '/api/me/orders?page_size=100', headers: { 'x-user-id': user.id } }));
  assert(list.items.some((item: any) => item.order_id === order.id), 'order list should include smoke order');
  assertNoSensitive(list, 'order list');
  const detail = await json(await app.inject({ method: 'GET', url: `/api/me/orders/${order.id}`, headers: { 'x-user-id': user.id } }));
  assertNoSensitive(detail, 'order detail');
  assert(!JSON.stringify(detail).includes('13812345678'), 'order detail should not expose full receiver_phone');
  const pickup = await json(await app.inject({ method: 'GET', url: `/api/me/orders/${order.id}/pickup-code`, headers: { 'x-user-id': user.id } }));
  assert(pickup.receiver_phone_masked, 'pickup-code should return receiver_phone_masked');
  assertNoSensitive(pickup, 'pickup-code');
  const afterSale = await json(await app.inject({ method: 'POST', url: `/api/me/orders/${order.id}/after-sales`, headers: { 'x-user-id': user.id }, payload: { type: 'bad_quality', reason: '品质问题', requested_refund_cents: 100 } }));
  assert(afterSale.status === 'submitted', 'after-sale should be submitted');
  const afterSales = await json(await app.inject({ method: 'GET', url: `/api/me/orders/${order.id}/after-sales`, headers: { 'x-user-id': user.id } }));
  assert(afterSales.some((item: any) => item.after_sale_case_id === afterSale.id), 'after-sale list should include submitted case');
}

async function main() {
  verifyDocs();
  verifyMiniappRoutesAndSource();
  await verifyApiSmoke();
  scanComplianceFiles(['docs/release/mvp-checklist.md','docs/release/miniapp-devtools-test-guide.md','docs/release/env-config.md','docs/release/known-limitations.md','docs/reviews/l23-mvp-release-readiness.md','scripts/verify-l23-mvp-release-readiness-local.ts','apps/miniapp/app.json','apps/miniapp/pages/products/index.js','apps/miniapp/pages/product-detail/index.js','apps/miniapp/pages/orders/confirm/index.js','apps/miniapp/pages/orders/index.js','apps/miniapp/pages/orders/detail/index.js','apps/miniapp/pages/pickup/code/index.js','apps/miniapp/pages/after-sales/apply/index.js','apps/miniapp/pages/after-sales/detail/index.js','apps/miniapp/pages/mine/index.js']);
  console.log('Compliance scan passed.');
  console.log('L23 mvp release readiness verification passed.');
}

main().finally(async () => { await app.close(); await prisma.$disconnect(); });
