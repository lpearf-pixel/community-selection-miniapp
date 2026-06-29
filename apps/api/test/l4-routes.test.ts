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


  it('registers L6 refund API routes', () => {
    const appSource = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
    const refundSource = readFileSync(new URL('../src/routes/refunds.ts', import.meta.url), 'utf8');
    expect(appSource.includes('registerRefundRoutes')).toBe(true);
    expect(refundSource.includes("/api/refunds'")).toBe(true);
    expect(refundSource.includes("/api/refunds/:id'")).toBe(true);
    expect(refundSource.includes("/api/refunds/mock'")).toBe(true);
    expect(refundSource.includes("/api/refunds/wechat/apply'")).toBe(true);
    expect(refundSource.includes("/api/refunds/wechat/notify'")).toBe(true);
    expect(refundSource.includes('createMockRefund')).toBe(true);
  });

  it('registers L7 commission API routes and service hooks', () => {
    const appSource = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
    const commissionRoutes = readFileSync(new URL('../src/routes/commissions.ts', import.meta.url), 'utf8');
    const paymentService = readFileSync(new URL('../src/services/payment-service.ts', import.meta.url), 'utf8');
    const refundService = readFileSync(new URL('../src/services/refund-service.ts', import.meta.url), 'utf8');
    const groupBuySource = readFileSync(new URL('../src/routes/group-buys.ts', import.meta.url), 'utf8');
    expect(appSource.includes('registerCommissionRoutes')).toBe(true);
    expect(commissionRoutes.includes("/api/leaders/me/commissions'")).toBe(true);
    expect(commissionRoutes.includes("/api/admin/commissions'")).toBe(true);
    expect(commissionRoutes.includes("/api/admin/commissions/settle'")).toBe(true);
    expect(paymentService.includes('ensureEstimatedCommission')).toBe(true);
    expect(refundService.includes('syncCommissionAfterRefund')).toBe(true);
    expect(groupBuySource.includes('markCommissionPendingForCompletedOrder')).toBe(true);
  });


  it('registers L7.5 business log routes and service', () => {
    const appSource = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
    const logRoutes = readFileSync(new URL('../src/routes/logs.ts', import.meta.url), 'utf8');
    const loggingService = readFileSync(new URL('../src/services/logging-service.ts', import.meta.url), 'utf8');
    expect(appSource.includes('registerLogRoutes')).toBe(true);
    expect(logRoutes.includes('/api/admin/logs/business-events')).toBe(true);
    expect(logRoutes.includes('/api/admin/logs/order-timeline')).toBe(true);
    expect(logRoutes.includes('/api/admin/logs/alerts')).toBe(true);
    expect(logRoutes.includes('/api/admin/logs/orders/:order_id/ai-context')).toBe(true);
    expect(loggingService.includes('sanitizePayload')).toBe(true);
    expect(loggingService.includes('recordBusinessEvent')).toBe(true);
    expect(loggingService.includes('raiseOpsAlert')).toBe(true);
  });


  it('registers L8 withdrawal API routes', () => {
    const appSource = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
    const withdrawalRoutes = readFileSync(new URL('../src/routes/withdrawals.ts', import.meta.url), 'utf8');
    expect(appSource.includes('registerWithdrawalRoutes')).toBe(true);
    expect(withdrawalRoutes.includes('/api/leaders/me/withdrawals')).toBe(true);
    expect(withdrawalRoutes.includes('/api/leaders/me/withdrawable-commissions')).toBe(true);
    expect(withdrawalRoutes.includes('/api/admin/withdrawals')).toBe(true);
    expect(withdrawalRoutes.includes('/api/admin/withdrawals/:id/approve')).toBe(true);
    expect(withdrawalRoutes.includes('/api/admin/withdrawals/:id/reject')).toBe(true);
    expect(withdrawalRoutes.includes('/api/admin/withdrawals/:id/mark-paid')).toBe(true);
  });


  it('registers L8 reward credit conversion reserve route', () => {
    const appSource = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
    const rewardRoutes = readFileSync(new URL('../src/routes/rewards.ts', import.meta.url), 'utf8');
    const logRoutes = readFileSync(new URL('../src/routes/logs.ts', import.meta.url), 'utf8');
    expect(appSource.includes('registerRewardRoutes')).toBe(true);
    expect(rewardRoutes.includes('/api/leaders/me/rewards/convert-credit')).toBe(true);
    expect(rewardRoutes.includes('tax_status')).toBe(true);
    expect(rewardRoutes.includes('reward_convert_credit_success')).toBe(true);
    expect(logRoutes.includes('credit_usage')).toBe(true);
    expect(logRoutes.includes('核查该消费额度来源及税务状态')).toBe(true);
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
