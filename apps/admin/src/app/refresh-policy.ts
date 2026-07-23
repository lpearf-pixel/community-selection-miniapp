import type { AdminViewKey } from './admin-view';

export type AdminRefreshTarget =
  | 'group-buys'
  | 'orders'
  | 'fulfillment'
  | 'after-sales'
  | 'catalog'
  | 'finance'
  | 'operations'
  | 'legacy';

export function adminRefreshTarget(view: AdminViewKey): AdminRefreshTarget {
  if (view === 'groupBuys' || view === 'failedGroupBuyClosure') {
    return 'group-buys';
  }
  if (view === 'orders') return 'orders';
  if (view === 'fulfillment') return 'fulfillment';
  if (view === 'afterSales') return 'after-sales';
  if (view === 'products') return 'catalog';
  if (view === 'finance' || view === 'operations') return view;
  return 'legacy';
}
