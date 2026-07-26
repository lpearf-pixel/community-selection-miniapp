import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { prisma } from '../db.js';

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const ids = {
  admin: `c2t3c-route-admin-${suffix}`,
  category: `C2T3C route category ${suffix}`,
  product: `C2T3C route product ${suffix}`,
};
let categoryId = '';
let productId = '';
const app = buildApp();

const headers = (role: 'super_admin' | 'clerk') => ({
  'x-admin-user-id': ids.admin,
  'x-admin-role': role,
});

const command = {
  expected_stock: 20,
  adjust_quantity: -3,
  reason: '门店盘点差异',
  idempotency_key: 'inventory-adjust-route-0001',
};

beforeAll(async () => {
  await app.ready();
  await prisma.adminUser.create({
    data: {
      id: ids.admin,
      username: ids.admin,
      password_hash: 'integration-only',
      status: 'active',
    },
  });
  const category = await prisma.category.create({
    data: { name: ids.category },
  });
  categoryId = category.id;
  const product = await prisma.product.create({
    data: {
      name: ids.product,
      category_id: category.id,
      price_cents: 100,
      cost_price_cents: 50,
      stock: 20,
      unit: '份',
      stock_unit: '份',
      status: 'active',
    },
  });
  productId = product.id;
});

beforeEach(async () => {
  await prisma.$transaction([
    prisma.stockLedger.deleteMany({ where: { product_id: productId } }),
    prisma.businessEventLog.deleteMany({
      where: {
        event_type: 'inventory_manual_adjusted',
        event_source: 'admin-inventory-adjust-command',
      },
    }),
    prisma.adminAuditLog.deleteMany({
      where: { target_type: 'Product', target_id: productId },
    }),
    prisma.adminCommandReceipt.deleteMany({
      where: { admin_user_id: ids.admin },
    }),
    prisma.product.update({
      where: { id: productId },
      data: { stock: 20 },
    }),
  ]);
});

afterAll(async () => {
  if (productId) {
    await prisma.stockLedger.deleteMany({ where: { product_id: productId } });
    await prisma.businessEventLog.deleteMany({
      where: {
        event_type: 'inventory_manual_adjusted',
        event_source: 'admin-inventory-adjust-command',
      },
    });
    await prisma.adminAuditLog.deleteMany({
      where: { target_type: 'Product', target_id: productId },
    });
    await prisma.adminCommandReceipt.deleteMany({
      where: { admin_user_id: ids.admin },
    });
    await prisma.product.deleteMany({ where: { id: productId } });
  }
  await prisma.category.deleteMany({ where: { id: categoryId } });
  await prisma.adminUser.deleteMany({ where: { id: ids.admin } });
  await app.close();
  await prisma.$disconnect();
});

describe.sequential('POST /api/admin/inventory/products/:id/adjust', () => {
  it('rejects unknown fields with the V1 invalid-command code', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/admin/inventory/products/${productId}/adjust`,
      headers: headers('super_admin'),
      payload: { ...command, extra: true },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      success: false,
      data: null,
      code: 'INVALID_ADMIN_INVENTORY_ADJUST_COMMAND',
      trace_id: expect.any(String),
    });
  });

  it('requires product.manage', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/admin/inventory/products/${productId}/adjust`,
      headers: headers('clerk'),
      payload: command,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      success: false,
      code: 'ADMIN_FORBIDDEN',
    });
  });

  it('returns a stable V1 result on success and replay', async () => {
    const request = {
      method: 'POST' as const,
      url: `/api/admin/inventory/products/${productId}/adjust`,
      headers: headers('super_admin'),
      payload: command,
    };
    const first = await app.inject(request);
    const replay = await app.inject(request);

    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      success: true,
      code: 'ADMIN_INVENTORY_ADJUSTED',
      data: {
        product_id: productId,
        stock_before: 20,
        stock_after: 17,
        adjust_quantity: -3,
        stock_unit: '份',
      },
    });
    expect(replay.json().data).toEqual(first.json().data);
  });

  it('returns a data-free conflict when visible stock is stale', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/admin/inventory/products/${productId}/adjust`,
      headers: headers('super_admin'),
      payload: {
        ...command,
        expected_stock: 19,
        idempotency_key: 'inventory-adjust-route-stale1',
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      success: false,
      data: null,
      code: 'ADMIN_INVENTORY_STOCK_CONFLICT',
    });
    expect(response.json()).not.toHaveProperty('current_stock');
  });
});
