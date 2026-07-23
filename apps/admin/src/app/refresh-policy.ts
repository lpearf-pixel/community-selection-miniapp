import type { AdminViewKey } from './admin-view';

export type AdminRefreshTarget = 'finance' | 'operations' | 'legacy';

export function adminRefreshTarget(view: AdminViewKey): AdminRefreshTarget {
  if (view === 'finance' || view === 'operations') return view;
  return 'legacy';
}
