import type { AdminViewKey } from './admin-view';
import { buildGroupedNavigation } from './navigation';

export function createShellNavigationModel(
  activeView: AdminViewKey,
  onNavigate: (view: AdminViewKey) => void,
) {
  return buildGroupedNavigation()
    .filter((group) => group.items.length > 0)
    .map((group) => ({
      ...group,
      active: group.items.some((item) => item.key === activeView),
      items: group.items.map((item) => ({
        ...item,
        active: item.key === activeView,
        onSelect: () => onNavigate(item.key),
      })),
    }));
}
