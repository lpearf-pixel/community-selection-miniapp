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
    expect(source.includes("/api/orders/:id/status'")).toBe(true);
    expect(source.includes("/api/orders/export/picking.csv'")).toBe(true);
  });

  it('registers L5 mock payment API routes', () => {
    const appSource = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
    const paymentSource = readFileSync(new URL('../src/routes/payments.ts', import.meta.url), 'utf8');
    expect(appSource.includes('registerPaymentRoutes')).toBe(true);
    expect(paymentSource.includes("/api/payments/mock'")).toBe(true);
    expect(paymentSource.includes("/api/payments/wechat/jsapi'")).toBe(true);
    expect(paymentSource.includes("/api/payments/wechat/notify'")).toBe(true);
  });

  it('keeps L4 order safeguards visible in route implementation', () => {
    expect(source.includes('client_request_id')).toBe(true);
    expect(source.includes('user_openid')).toBe(true);
    expect(source.includes('leader_openid')).toBe(true);
    expect(source.includes('stock: { gte: quantity }')).toBe(true);
    expect(source.includes('stock: { decrement: quantity }')).toBe(true);
    expect(source.includes('group_buy_expired')).toBe(true);
    expect(source.includes('quantity,')).toBe(true);
    const serviceSource = readFileSync(new URL('../src/services/payment-service.ts', import.meta.url), 'utf8');
    expect(serviceSource.includes('current_quantity: { increment: order.quantity }')).toBe(true);
    expect(source.includes('refund.upsert')).toBe(true);
    expect(source.includes('pay_amount_cents / groupBuy.price_cents')).toBe(false);
  });

  it('keeps L5 payment idempotency safeguards visible', () => {
    const paymentSource = readFileSync(new URL('../src/routes/payments.ts', import.meta.url), 'utf8');
    const serviceSource = readFileSync(new URL('../src/services/payment-service.ts', import.meta.url), 'utf8');
    expect(paymentSource.includes('payment.upsert')).toBe(true);
    expect(paymentSource.includes('markOrderPaid')).toBe(true);
    expect(paymentSource.includes('MOCK_WECHAT_PAY')).toBe(true);
    expect(serviceSource.includes("where: { id: order.id, pay_status: 'unpaid' }")).toBe(true);
    expect(serviceSource.includes('payment_mark_order_paid')).toBe(true);
  });
});
