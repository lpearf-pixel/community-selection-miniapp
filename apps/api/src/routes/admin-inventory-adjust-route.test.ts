import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';

const app = buildApp();

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('Admin inventory adjustment route boundary', () => {
  it('returns the V1 unauthorized envelope without Admin identity', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/inventory/products/missing/adjust',
      payload: {
        expected_stock: 20,
        adjust_quantity: -3,
        reason: '门店盘点差异',
        idempotency_key: 'inventory-adjust-route-0001',
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      success: false,
      data: null,
      code: 'ADMIN_UNAUTHORIZED',
      trace_id: expect.any(String),
    });
  });
});
