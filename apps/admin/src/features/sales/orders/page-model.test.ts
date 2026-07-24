import { describe, expect, it } from 'vitest';
import { applyOrderFilters, changeOrderPage } from './page-model';

describe('orders page model', () => {
  it('resets the page and trims empty fields when filters are applied', () => {
    expect(
      applyOrderFilters(
        {
          page: 4,
          page_size: 20,
          refund_status: 'pending',
        },
        {
          keyword: '  WX-100  ',
          order_type: 'group_buy',
          refund_status: undefined,
        },
      ),
    ).toEqual({
      page: 1,
      page_size: 20,
      keyword: 'WX-100',
      order_type: 'group_buy',
    });
  });

  it('keeps filters when only pagination changes', () => {
    expect(
      changeOrderPage(
        {
          page: 1,
          page_size: 20,
          refund_status: 'pending',
        },
        3,
        50,
      ),
    ).toEqual({
      page: 3,
      page_size: 50,
      refund_status: 'pending',
    });
  });
});
