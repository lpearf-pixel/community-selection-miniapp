import { writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { prisma } from '../../apps/api/src/db.js';
import { hashPassword } from '../../apps/api/src/services/admin-auth-service.js';

const runSuffix = String(
  process.env.ADMIN_E2E_RUN_ID ?? process.env.GITHUB_RUN_ID ?? 'local',
).replace(/[^a-zA-Z0-9_-]/g, '-');
const username = `l50_e2e_admin_${runSuffix}`;
const password = 'L50-E2E-StrongPassword-123';
const fixturePath = resolve('scripts/admin-e2e/.fixture.json');
const orderNo = `L50-C2-T2-${runSuffix}-DELIVERY`;
const pickupOrderNo = `L50-C2-T2-${runSuffix}-PICKUP`;
const refundOrderNo = `L50-C2-T3A-${runSuffix}-REFUND`;
const customerOpenid = `l50-c2-t2-${runSuffix}-customer`;
const categoryName = `L50-C2-T2 ${runSuffix} 分类`;
const productName = `L50-C2-T2 ${runSuffix} 商品`;
const communityName = `L50-C2-T2 ${runSuffix} 社区`;
const pickupStoreId = `l50-c2-t2-${runSuffix}-pickup-store`;

async function cleanup() {
  const orders = await prisma.order.findMany({
    where: { order_no: { in: [orderNo, pickupOrderNo, refundOrderNo] } },
    select: { id: true },
  });
  const orderIds = orders.map((order) => order.id);
  if (orderIds.length) {
    const cases = await prisma.afterSaleCase.findMany({
      where: { order_id: { in: orderIds } },
      select: { id: true },
    });
    const caseIds = cases.map((item) => item.id);
    if (caseIds.length) {
      await prisma.afterSaleLog.deleteMany({
        where: { after_sale_case_id: { in: caseIds } },
      });
    }
    await prisma.afterSaleCase.deleteMany({
      where: { order_id: { in: orderIds } },
    });
    await prisma.refund.deleteMany({ where: { order_id: { in: orderIds } } });
    await prisma.adminCommandReceipt.deleteMany({
      where: { target_id: { in: orderIds } },
    });
    await prisma.businessEventLog.deleteMany({
      where: { order_id: { in: orderIds } },
    });
    await prisma.adminAuditLog.deleteMany({
      where: { target_type: 'Order', target_id: { in: orderIds } },
    });
    await prisma.orderTimelineLog.deleteMany({
      where: { order_id: { in: orderIds } },
    });
    await prisma.order.deleteMany({
      where: { order_no: { in: [orderNo, pickupOrderNo, refundOrderNo] } },
    });
  }
  await prisma.product.deleteMany({ where: { name: productName } });
  await prisma.category.deleteMany({ where: { name: categoryName } });
  await prisma.user.deleteMany({ where: { openid: customerOpenid } });
  await prisma.community.deleteMany({ where: { name: communityName } });
  await prisma.pickupStore.deleteMany({ where: { id: pickupStoreId } });
  const users = await prisma.adminUser.findMany({
    where: { username },
    select: { id: true },
  });
  const ids = users.map((user) => user.id);
  if (ids.length) {
    await prisma.adminCommandReceipt.deleteMany({
      where: { admin_user_id: { in: ids } },
    });
    await prisma.adminAuditLog.deleteMany({
      where: { admin_user_id: { in: ids } },
    });
    await prisma.adminSession.deleteMany({
      where: { admin_user_id: { in: ids } },
    });
    await prisma.adminUser.deleteMany({ where: { id: { in: ids } } });
  }
  await rm(fixturePath, { force: true });
}

async function setup() {
  await cleanup();
  const customer = await prisma.user.create({
    data: {
      openid: customerOpenid,
      nickname: 'C2-T2 浏览器测试用户',
      phone: '13812348000',
      role: 'customer',
      status: 'active',
    },
  });
  const category = await prisma.category.create({
    data: {
      name: categoryName,
      sort_order: 999,
      status: 'active',
    },
  });
  const product = await prisma.product.create({
    data: {
      name: productName,
      category_id: category.id,
      cover_image: '/images/products/placeholder.png',
      images: [],
      description: 'L50-C2-T2 自提核销浏览器测试商品',
      price_cents: 2590,
      cost_price_cents: 1800,
      stock: 20,
      unit: '份',
      stock_unit: 'piece',
      sale_unit: '份',
      stock_deduct_quantity: 1,
      is_group_enabled: false,
      commission_type: 'none',
      commission_value: 0,
      status: 'active',
    },
  });
  const community = await prisma.community.create({
    data: {
      name: communityName,
      address: '测试路 100 号',
      status: 'active',
    },
  });
  const pickupStore = await prisma.pickupStore.create({
    data: {
      id: pickupStoreId,
      name: `L50-C2-T2 ${runSuffix} 自提点`,
      address: '测试路 101 号',
      phone: '021-88886666',
      status: 'active',
    },
  });

  const fixtureTime = Date.now();
  const pickupOrder = await prisma.order.create({
    data: {
      order_no: pickupOrderNo,
      user_id: customer.id,
      product_id: product.id,
      pickup_store_id: pickupStore.id,
      total_amount_cents: 2590,
      product_amount_cents: 2590,
      pay_amount_cents: 2590,
      quantity: 1,
      pay_status: 'paid',
      order_status: 'ready',
      version: 1,
      refund_status: 'none',
      pickup_type: 'store',
      receiver_name: '浏览器测试用户',
      receiver_phone: '13812348000',
      receiver_address: null,
      created_at: new Date(fixtureTime - 1_000),
      paid_at: new Date(fixtureTime - 2_000),
    },
  });
  const order = await prisma.order.create({
    data: {
      order_no: orderNo,
      user_id: customer.id,
      product_id: product.id,
      community_id: community.id,
      total_amount_cents: 2590,
      product_amount_cents: 2590,
      pay_amount_cents: 2590,
      quantity: 1,
      pay_status: 'paid',
      order_status: 'ready',
      version: 1,
      refund_status: 'none',
      pickup_type: 'delivery',
      receiver_name: '浏览器测试用户',
      receiver_phone: '13812348000',
      receiver_address: '测试市测试区测试路 100 号',
      created_at: new Date(fixtureTime),
      paid_at: new Date(fixtureTime - 2_000),
    },
  });
  const refundOrder = await prisma.order.create({
    data: {
      order_no: refundOrderNo,
      user_id: customer.id,
      product_id: product.id,
      community_id: community.id,
      total_amount_cents: 2590,
      product_amount_cents: 2590,
      pay_amount_cents: 2590,
      quantity: 1,
      pay_status: 'paid',
      order_status: 'ready',
      version: 1,
      refund_status: 'none',
      pickup_type: 'delivery',
      receiver_name: '退款浏览器测试用户',
      receiver_phone: '13812348000',
      receiver_address: '测试市测试区退款路 100 号',
      created_at: new Date(fixtureTime + 1_000),
      paid_at: new Date(fixtureTime - 2_000),
    },
  });
  const refundCase = await prisma.afterSaleCase.create({
    data: {
      order_id: refundOrder.id,
      user_id: customer.id,
      product_id: product.id,
      type: 'refund',
      status: 'approved',
      resolution_type: 'partial_refund',
      reason: 'L50-C2-T3A 浏览器并发退款',
      requested_refund_cents: 990,
      requested_product_refund_cents: 990,
      requested_delivery_refund_cents: 0,
      approved_refund_cents: 990,
      approved_product_refund_cents: 990,
      approved_delivery_refund_cents: 0,
      reviewed_at: new Date(fixtureTime + 2_000),
    },
  });
  await prisma.adminUser.create({
    data: {
      username,
      password_hash: await hashPassword(password),
      role: 'admin',
      totp_enabled: false,
    },
  });
  await writeFile(
    fixturePath,
    JSON.stringify({
      username,
      password,
      orderId: order.id,
      orderNo: order.order_no,
      pickupOrderId: pickupOrder.id,
      pickupOrderNo: pickupOrder.order_no,
      refundOrderId: refundOrder.id,
      refundOrderNo: refundOrder.order_no,
      refundCaseId: refundCase.id,
    }),
    { mode: 0o600 },
  );
}

const action = process.argv[2];
if (action === 'setup') await setup();
else if (action === 'cleanup') await cleanup();
else throw new Error('usage: fixture.ts <setup|cleanup>');

await prisma.$disconnect();
