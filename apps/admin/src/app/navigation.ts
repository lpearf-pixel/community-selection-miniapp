import { ADMIN_FEATURES } from './feature-registry';

export function buildLegacyNavigation() {
  return ADMIN_FEATURES.map(({ key, label }) => ({ key, label }));
}
