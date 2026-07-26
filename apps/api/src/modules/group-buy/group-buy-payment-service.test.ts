import { beforeEach, describe, expect, it, vi } from 'vitest';
import { refreshGroupBuyAfterPayment } from './group-buy-payment-service.js';

const queryRaw = vi.fn();
const findUnique = vi.fn();
const aggregate = vi.fn();
const count = vi.fn();
const update = vi.fn();
const createBusinessEvent = vi.fn();
const tx = {
  $queryRaw: queryRaw,
  groupBuy: {
    findUnique,
    update,
  },
  order: {
    aggregate,
    count,
  },
  businessEventLog: {
    create: createBusinessEvent,
  },
} as any;

const now = new Date('2026-07-25T01:00:00.000Z');
const groupBuy = {
  id: 'group-1',
  product_id: 'product-1',
  leader_user_id: 'leader-1',
  community_id: 'community-1',
  min_people: 2,
  min_quantity: 3,
  current_people: 0,
  current_quantity: 0,
  price_cents: 1000,
  start_time: new Date('2026-07-24T00:00:00.000Z'),
  end_time: new Date('2026-07-26T00:00:00.000Z'),
  pickup_time: new Date('2026-07-27T00:00:00.000Z'),
  status: 'pending',
  created_at: new Date('2026-07-24T00:00:00.000Z'),
  updated_at: new Date('2026-07-24T00:00:00.000Z'),
};

beforeEach(() => {
  queryRaw.mockReset();
  findUnique.mockReset();
  aggregate.mockReset();
  count.mockReset();
  update.mockReset();
  createBusinessEvent.mockReset();
  queryRaw.mockResolvedValue([{ id: groupBuy.id }]);
});

describe('group-buy payment owner', () => {
  it('locks the group row before reading paid-order progress', async () => {
    findUnique.mockResolvedValue(groupBuy);
    aggregate.mockResolvedValue({ _sum: { quantity: 2 } });
    count.mockResolvedValue(1);
    update.mockResolvedValue({
      ...groupBuy,
      current_quantity: 2,
      current_people: 1,
    });

    await refreshGroupBuyAfterPayment(tx, groupBuy.id, now);

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      aggregate.mock.invocationCallOrder[0],
    );
    expect(queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      count.mock.invocationCallOrder[0],
    );
    expect(String(queryRaw.mock.calls[0][0])).toContain(
      'SELECT id FROM "GroupBuy" WHERE id = ',
    );
    expect(String(queryRaw.mock.calls[0][0])).toContain('FOR UPDATE');
    expect(queryRaw.mock.calls[0][1]).toBe(groupBuy.id);
  });

  it('refreshes absolute progress without succeeding below target', async () => {
    findUnique.mockResolvedValue(groupBuy);
    aggregate.mockResolvedValue({ _sum: { quantity: 2 } });
    count.mockResolvedValue(1);
    update.mockResolvedValue({
      ...groupBuy,
      current_quantity: 2,
      current_people: 1,
    });

    await expect(
      refreshGroupBuyAfterPayment(tx, groupBuy.id, now),
    ).resolves.toEqual({
      group_buy_id: groupBuy.id,
      status: 'pending',
      paid_quantity: 2,
      paid_people: 1,
      target_count: 3,
      is_success: false,
      became_success: false,
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: groupBuy.id },
      data: {
        current_quantity: 2,
        current_people: 1,
      },
    });
    expect(createBusinessEvent).not.toHaveBeenCalled();
  });

  it('marks the group successful and records the first transition at target', async () => {
    findUnique.mockResolvedValue(groupBuy);
    aggregate.mockResolvedValue({ _sum: { quantity: 3 } });
    count.mockResolvedValue(2);
    update.mockResolvedValue({
      ...groupBuy,
      status: 'success',
      current_quantity: 3,
      current_people: 2,
    });
    createBusinessEvent.mockResolvedValue({ id: 'event-1' });

    await expect(
      refreshGroupBuyAfterPayment(tx, groupBuy.id, now),
    ).resolves.toEqual({
      group_buy_id: groupBuy.id,
      status: 'success',
      paid_quantity: 3,
      paid_people: 2,
      target_count: 3,
      is_success: true,
      became_success: true,
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: groupBuy.id },
      data: {
        status: 'success',
        current_quantity: 3,
        current_people: 2,
      },
    });
    expect(createBusinessEvent).toHaveBeenCalledWith({
      data: expect.objectContaining({
        event_type: 'group_buy_success_refreshed',
        event_source: 'group-buy-payment-service',
        group_buy_id: groupBuy.id,
        payload: {
          paid_quantity: 3,
          paid_people: 2,
          target_count: 3,
          status: 'success',
        },
      }),
    });
  });

  it('returns stable success without rewriting or re-emitting the transition', async () => {
    findUnique.mockResolvedValue({
      ...groupBuy,
      status: 'success',
      current_quantity: 3,
      current_people: 2,
    });

    await expect(
      refreshGroupBuyAfterPayment(tx, groupBuy.id, now),
    ).resolves.toEqual({
      group_buy_id: groupBuy.id,
      status: 'success',
      paid_quantity: 3,
      paid_people: 2,
      target_count: 3,
      is_success: true,
      became_success: false,
    });

    expect(aggregate).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(createBusinessEvent).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'expired',
      value: {
        ...groupBuy,
        end_time: new Date('2026-07-25T00:59:59.999Z'),
      },
    },
    {
      name: 'failed',
      value: { ...groupBuy, status: 'failed' },
    },
  ])('does not upgrade a $name group', async ({ value }) => {
    findUnique.mockResolvedValue(value);

    await expect(
      refreshGroupBuyAfterPayment(tx, groupBuy.id, now),
    ).resolves.toMatchObject({
      group_buy_id: groupBuy.id,
      status: value.status,
      is_success: false,
      became_success: false,
    });

    expect(aggregate).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('returns null for a missing group after taking the keyed row lock', async () => {
    findUnique.mockResolvedValue(null);

    await expect(
      refreshGroupBuyAfterPayment(tx, groupBuy.id, now),
    ).resolves.toBeNull();

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(aggregate).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
