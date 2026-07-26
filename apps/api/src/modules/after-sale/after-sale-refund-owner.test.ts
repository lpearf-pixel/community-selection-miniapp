import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  claimApprovedAfterSaleForRefund,
  resolveAfterSaleWithRefund,
} from './after-sale-refund-service.js';

const findUnique = vi.fn();
const findUniqueOrThrow = vi.fn();
const updateMany = vi.fn();
const update = vi.fn();
const createLog = vi.fn();
const createEvent = vi.fn();
const createTimeline = vi.fn();
const tx = {
  afterSaleCase: { findUnique, findUniqueOrThrow, updateMany, update },
  afterSaleLog: { create: createLog },
  businessEventLog: { create: createEvent },
  orderTimelineLog: { create: createTimeline },
} as any;

const item = {
  id: 'after-sale-1',
  order_id: 'order-1',
  user_id: 'user-1',
  group_buy_id: null,
  product_id: 'product-1',
  type: 'bad_quality',
  status: 'approved',
  resolution_type: 'partial_refund',
  reason: '品质问题',
  description: null,
  requested_refund_cents: 500,
  requested_product_refund_cents: 500,
  requested_delivery_refund_cents: 0,
  approved_refund_cents: 500,
  approved_product_refund_cents: 500,
  approved_delivery_refund_cents: 0,
  evidence_image_urls: null,
  responsibility: 'platform',
  customer_note: null,
  admin_note: null,
  refund_id: null,
  inventory_loss_id: null,
  reviewed_by_admin_id: 'admin-1',
  resolved_by_admin_id: null,
  reviewed_at: new Date(),
  resolved_at: null,
  cancelled_at: null,
  created_at: new Date(),
  updated_at: new Date(),
  order: { id: 'order-1', order_status: 'paid' },
};

beforeEach(() => {
  for (const mock of [
    findUnique,
    findUniqueOrThrow,
    updateMany,
    update,
    createLog,
    createEvent,
    createTimeline,
  ]) mock.mockReset();
});

describe('after-sale refund owner', () => {
  it('conditionally claims an approved case for refund', async () => {
    const processing = {
      ...item,
      status: 'processing',
      resolved_by_admin_id: 'admin-1',
      admin_note: '执行退款',
    };
    findUnique.mockResolvedValue(item);
    updateMany.mockResolvedValue({ count: 1 });
    findUniqueOrThrow.mockResolvedValue(processing);

    await expect(claimApprovedAfterSaleForRefund(tx, {
      after_sale_case_id: item.id,
      admin_user_id: 'admin-1',
      admin_note: '执行退款',
    })).resolves.toEqual({ before: item, after: processing });

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: item.id, status: 'approved' },
      data: {
        status: 'processing',
        resolved_by_admin_id: 'admin-1',
        admin_note: '执行退款',
      },
    });
  });

  it('rejects a lost concurrent claim', async () => {
    findUnique.mockResolvedValue(item);
    updateMany.mockResolvedValue({ count: 0 });

    await expect(claimApprovedAfterSaleForRefund(tx, {
      after_sale_case_id: item.id,
      admin_user_id: 'admin-1',
      admin_note: '执行退款',
    })).rejects.toThrowError('当前售后状态不可执行退款');
  });

  it('resolves only a processing case and records strict owner effects', async () => {
    const processing = { ...item, status: 'processing' };
    const resolved = {
      ...processing,
      status: 'resolved',
      refund_id: 'refund-1',
      resolved_at: new Date(),
    };
    findUnique.mockResolvedValue(processing);
    update.mockResolvedValue(resolved);
    createLog.mockResolvedValue({ id: 'log-1' });
    createEvent.mockResolvedValue({ id: 'event-1' });
    createTimeline.mockResolvedValue({ id: 'timeline-1' });

    await expect(resolveAfterSaleWithRefund(tx, {
      after_sale_case_id: item.id,
      refund_id: 'refund-1',
      admin_user_id: 'admin-1',
      admin_note: '执行退款',
      idempotency_key: 'key-1',
    })).resolves.toEqual(resolved);

    expect(update).toHaveBeenCalledWith({
      where: { id: item.id },
      data: {
        status: 'resolved',
        refund_id: 'refund-1',
        resolved_at: expect.any(Date),
      },
    });
    expect(createLog).toHaveBeenCalledTimes(1);
    expect(createEvent).toHaveBeenCalledTimes(1);
    expect(createTimeline).toHaveBeenCalledTimes(1);
  });

  it('rejects resolving a case outside processing', async () => {
    findUnique.mockResolvedValue(item);
    await expect(resolveAfterSaleWithRefund(tx, {
      after_sale_case_id: item.id,
      refund_id: 'refund-1',
      admin_user_id: 'admin-1',
      admin_note: '执行退款',
      idempotency_key: 'key-1',
    })).rejects.toThrowError('当前售后状态不可执行退款');
    expect(update).not.toHaveBeenCalled();
  });
});
