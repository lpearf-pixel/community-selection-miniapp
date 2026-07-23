import type { AdminViewKey } from './admin-view';

export type AdminRefreshTarget =
  | 'catalog'
  | 'finance'
  | 'operations'
  | 'legacy';

export function adminRefreshTarget(view: AdminViewKey): AdminRefreshTarget {
  if (view === 'products') return 'catalog';
  if (view === 'finance' || view === 'operations') return view;
  return 'legacy';
}
