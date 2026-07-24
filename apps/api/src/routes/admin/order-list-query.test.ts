import { describe, expect, it } from 'vitest';
import {
  buildAdminOrderListWhere,
  parseAdminOrderListQuery,
  toAdminOrderListItem,
} from './order-list-query.js';

const orderFixture = {
  id: 'order-1',
  order_no: 'WX-100',
  user_id: 'user-1',
  group_buy_id: 'group-1',
  product_id: null,
  quantity: 2,
  total_amount_cents: 5200,
  pay_amount_cents: 5000,
  refund_amount_cents: 300,
  pay_status: 'paid',
  order_status: 'preparing',
  refund_status: 'pending',
  pickup_type: 'delivery',
  receiver_name: '张三',
  receiver_phone: '13812348000',
  receiver_address: '南京市玄武区中山路100号',
  created_at: new Date('2026-07-24T00:00:00.000Z'),
  paid_at: new Date('2026-07-24T00:01:00.000Z'),
  user: { id: 'user-1', nickname: '社区用户' },
  product: null,
  group_buy: {
    id: 'group-1',
    product: {
      id: 'product-1',
      name: '有机番茄',
      cover_image: 'https://example.test/tomato.jpg',
      price_cents: 2600,
      sale_unit: '份',
      sale_spec_name: '500g',
    },
    community: { id: 'community-1', name: '玄武社区' },
  },
  pickup_store: null,
  community: null,
};

describe('Admin order list query', () => {
  it('normalizes bounded pagination and supported filters', () => {
    expect(
      parseAdminOrderListQuery({
        keyword: '  WX-100  ',
        order_type: 'group_buy',
        pickup_type: 'delivery',
        pay_status: 'paid',
        order_status: 'preparing',
        refund_status: 'pending',
        page: '2',
        page_size: '200',
      }),
    ).toEqual({
      ok: true,
      value: {
        keyword: 'WX-100',
        order_type: 'group_buy',
        pickup_type: 'delivery',
        pay_status: 'paid',
        order_status: 'preparing',
        refund_status: 'pending',
        page: 2,
        page_size: 100,
      },
    });
  });

  it('uses safe defaults and rejects unsupported enum filters', () => {
    expect(parseAdminOrderListQuery({})).toEqual({
      ok: true,
      value: { page: 1, page_size: 20 },
    });
    expect(parseAdminOrderListQuery({ pay_status: 'unknown' })).toEqual({
      ok: false,
      code: 'INVALID_ADMIN_ORDER_QUERY',
      message: 'Unsupported pay_status',
    });
    expect(parseAdminOrderListQuery({ page: '0' })).toEqual({
      ok: false,
      code: 'INVALID_ADMIN_ORDER_QUERY',
      message: 'page must be a positive integer',
    });
  });

  it('accepts the maximum safe page and rejects a larger offset', () => {
    expect(parseAdminOrderListQuery({ page: '10000' })).toEqual({
      ok: true,
      value: { page: 10_000, page_size: 20 },
    });
    expect(parseAdminOrderListQuery({ page: '10001' })).toEqual({
      ok: false,
      code: 'INVALID_ADMIN_ORDER_QUERY',
      message: 'page must not exceed 10000',
    });
  });

  it('composes data scope and filters for Prisma-side pagination', () => {
    expect(
      buildAdminOrderListWhere(
        {
          keyword: 'WX-100',
          order_type: 'normal',
          pickup_type: 'store',
          pay_status: 'paid',
          order_status: 'ready',
          refund_status: 'none',
          page: 3,
          page_size: 50,
        },
        { OR: [{ pickup_store_id: { in: ['store-1'] } }] },
      ),
    ).toEqual({
      AND: [
        { OR: [{ pickup_store_id: { in: ['store-1'] } }] },
        { group_buy_id: null },
        { pickup_type: 'store' },
        { pay_status: 'paid' },
        { order_status: 'ready' },
        { refund_status: 'none' },
        {
          OR: [
            {
              order_no: {
                contains: 'WX-100',
                mode: 'insensitive',
              },
            },
            {
              receiver_name: {
                contains: 'WX-100',
                mode: 'insensitive',
              },
            },
            { receiver_phone: { contains: 'WX-100' } },
          ],
        },
      ],
    });
  });

  it('projects one masked historical WeChat order item', () => {
    const item = toAdminOrderListItem(orderFixture);

    expect(item).toMatchObject({
      id: 'order-1',
      order_no: 'WX-100',
      order_type: 'group_buy',
      channel: {
        code: 'wechat_miniapp',
        label: '微信小程序',
        source: 'historical_default',
      },
      product: {
        product_id: 'product-1',
        name: '有机番茄',
      },
      community: {
        community_id: 'community-1',
        name: '玄武社区',
      },
      receiver_phone_masked: '138****8000',
      receiver_address_masked: '南京市玄武区***',
    });
    expect(item).not.toHaveProperty('receiver_phone');
    expect(item).not.toHaveProperty('receiver_address');
  });
});
