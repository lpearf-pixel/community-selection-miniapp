import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../src/routes/group-buys.ts', import.meta.url), 'utf8');

describe('L4 group-buy and order routes', () => {
  it('registers the required group-buy and order API routes', () => {
    expect(source.includes("/api/group-buys'")).toBe(true);
    expect(source.includes("/api/group-buys/:id'")).toBe(true);
    expect(source.includes("/api/group-buys/:id/join'")).toBe(true);
    expect(source.includes("/api/orders'")).toBe(true);
    expect(source.includes("/api/orders/:id'")).toBe(true);
    expect(source.includes("/api/orders/:id/complete'")).toBe(true);
    expect(source.includes("/api/orders/:id/mock-pay'")).toBe(true);
    expect(source.includes("/api/orders/:id/status'")).toBe(true);
    expect(source.includes("/api/orders/export/picking.csv'")).toBe(true);
  });

  it('keeps L4 order safeguards visible in route implementation', () => {
    expect(source.includes('client_request_id')).toBe(true);
    expect(source.includes('user_openid')).toBe(true);
    expect(source.includes('leader_openid')).toBe(true);
    expect(source.includes('stock: { gte: quantity }')).toBe(true);
    expect(source.includes('stock: { decrement: quantity }')).toBe(true);
    expect(source.includes('group_buy_expired')).toBe(true);
    expect(source.includes('quantity,')).toBe(true);
    expect(source.includes('current_quantity: { increment: order.quantity }')).toBe(true);
    expect(source.includes('refund.upsert')).toBe(true);
    expect(source.includes('pay_amount_cents / groupBuy.price_cents')).toBe(false);
  });
});
