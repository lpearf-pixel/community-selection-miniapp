import { describe, expect, it, vi } from 'vitest';
import { createShellNavigationModel } from './shell-model';

describe('shell navigation model', () => {
  it('shows only non-empty modules in the approved order', () => {
    const onNavigate = vi.fn();
    const groups = createShellNavigationModel('orders', onNavigate);

    expect(groups.map(({ key, label }) => [key, label])).toEqual([
      ['today', '今日经营'],
      ['sales-fulfillment', '销售与履约'],
      ['catalog-pricing', '商品与价格'],
      ['inventory-supply', '库存与供应链'],
      ['membership-marketing', '会员与营销'],
      ['finance-settlement', '财务与结算'],
      ['analytics', '数据分析'],
      ['operations-risk', '运维与风控'],
    ]);
    expect(groups.flatMap((group) => group.items)).toHaveLength(24);
  });

  it('marks the active module and view and delegates navigation', () => {
    const onNavigate = vi.fn();
    const groups = createShellNavigationModel('orders', onNavigate);
    const sales = groups.find((group) => group.key === 'sales-fulfillment');
    const orders = sales?.items.find((item) => item.key === 'orders');

    expect(sales?.active).toBe(true);
    expect(orders?.active).toBe(true);
    orders?.onSelect();
    expect(onNavigate).toHaveBeenCalledWith('orders');
  });
});
