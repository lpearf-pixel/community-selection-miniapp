import type { AdminViewKey } from './admin-view';
import { buildLegacyNavigation } from './navigation';

export function createShellNavigationModel(
  activeView: AdminViewKey,
  onNavigate: (view: AdminViewKey) => void,
) {
  return buildLegacyNavigation().map((item) => ({
    ...item,
    active: item.key === activeView,
    onSelect: () => onNavigate(item.key),
  }));
}
