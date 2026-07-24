import type { AdminViewKey } from './admin-view';

export type AdminRefreshTarget =
  | 'group-buys'
  | 'orders'
  | 'fulfillment'
  | 'after-sales'
  | 'catalog'
  | 'finance'
  | 'operations'
  | 'inventory'
  | 'purchase-plans'
  | 'suppliers'
  | 'batches'
  | 'expiry-alerts'
  | 'stock-checks'
  | 'withdrawals'
  | 'alerts'
  | 'tax-review'
  | 'legacy';

export function adminRefreshTarget(view: AdminViewKey): AdminRefreshTarget {
  if (view === 'groupBuys' || view === 'failedGroupBuyClosure') {
    return 'group-buys';
  }
  if (view === 'orders') return 'orders';
  if (view === 'fulfillment') return 'fulfillment';
  if (view === 'afterSales') return 'after-sales';
  if (view === 'inventory') return 'inventory';
  if (view === 'purchasePlans') return 'purchase-plans';
  if (view === 'suppliers') return 'suppliers';
  if (view === 'batches') return 'batches';
  if (view === 'expiryAlerts') return 'expiry-alerts';
  if (view === 'stockChecks') return 'stock-checks';
  if (view === 'withdrawals') return 'withdrawals';
  if (view === 'alerts') return 'alerts';
  if (view === 'taxRecords') return 'tax-review';
  if (view === 'products') return 'catalog';
  if (view === 'finance' || view === 'operations') return view;
  return 'legacy';
}
