import { describe, expect, it, vi } from 'vitest';
import { createShellNavigationModel } from './shell-model';

describe('shell navigation model', () => {
  it('marks the active view and delegates navigation', () => {
    const onNavigate = vi.fn();
    const items = createShellNavigationModel('orders', onNavigate);
    const orders = items.find((item) => item.key === 'orders');

    expect(orders?.active).toBe(true);
    orders?.onSelect();
    expect(onNavigate).toHaveBeenCalledWith('orders');
  });
});
