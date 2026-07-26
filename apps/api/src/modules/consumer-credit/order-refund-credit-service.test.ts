import { beforeEach, describe, expect, it, vi } from 'vitest';
import { returnOrderCreditAfterFullRefund } from './order-refund-credit-service.js';

const findFirst = vi.fn();
const findMany = vi.fn();
const createLedger = vi.fn();
const createEvent = vi.fn();
const createTimeline = vi.fn();
const tx = {
  consumerCreditLedger: {
    findFirst,
    findMany,
    create: createLedger,
  },
  businessEventLog: { create: createEvent },
  orderTimelineLog: { create: createTimeline },
} as any;

const order = {
  id: 'order-1',
  user_id: 'user-1',
  credit_amount_cents: 300,
  credit_source_type: 'reward_conversion',
  credit_source_id: 'conversion-1',
};

beforeEach(() => {
  for (const mock of [
    findFirst,
    findMany,
    createLedger,
    createEvent,
    createTimeline,
  ]) mock.mockReset();
});

describe('order refund consumer credit owner', () => {
  it.each([
    [{ ...order }, false],
    [{ ...order, credit_amount_cents: 0 }, true],
    [{ ...order, credit_source_type: 'manual' }, true],
  ])('skips inapplicable return for %#', async (inputOrder, full) => {
    await expect(returnOrderCreditAfterFullRefund(tx, {
      order: inputOrder as any,
      refund_id: 'refund-1',
      is_full_refund: full,
    })).resolves.toEqual({
      applied: false,
      idempotent: false,
      amount_cents: 0,
    });
    expect(createLedger).not.toHaveBeenCalled();
  });

  it('returns an idempotent result when order credit was already returned', async () => {
    findFirst.mockResolvedValue({ id: 'credit-1', amount_cents: 300 });
    await expect(returnOrderCreditAfterFullRefund(tx, {
      order: order as any,
      refund_id: 'refund-1',
      is_full_refund: true,
    })).resolves.toEqual({
      applied: false,
      idempotent: true,
      amount_cents: 300,
    });
    expect(createLedger).not.toHaveBeenCalled();
  });

  it('creates one inbound ledger row from the current literal balance', async () => {
    findFirst.mockResolvedValue(null);
    findMany.mockResolvedValue([
      { direction: 'in', amount_cents: 1000 },
      { direction: 'out', amount_cents: 250 },
    ]);
    createLedger.mockResolvedValue({ id: 'credit-2', amount_cents: 300 });
    createEvent.mockResolvedValue({ id: 'event-1' });
    createTimeline.mockResolvedValue({ id: 'timeline-1' });

    await expect(returnOrderCreditAfterFullRefund(tx, {
      order: order as any,
      refund_id: 'refund-1',
      is_full_refund: true,
    })).resolves.toEqual({
      applied: true,
      idempotent: false,
      amount_cents: 300,
    });
    expect(createLedger).toHaveBeenCalledWith({
      data: {
        user_id: 'user-1',
        source_type: 'order_refund',
        source_id: 'order-1',
        direction: 'in',
        amount_cents: 300,
        balance_after_cents: 1050,
        usable_scope: 'platform_order',
        remark: '订单退款退回消费额度',
        payload: {
          original_credit_source_type: 'reward_conversion',
          original_credit_source_id: 'conversion-1',
        },
      },
    });
    expect(createEvent).toHaveBeenCalledTimes(1);
    expect(createTimeline).toHaveBeenCalledTimes(1);
  });
});
