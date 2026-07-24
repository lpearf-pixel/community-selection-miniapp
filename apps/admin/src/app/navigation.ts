import {
  ADMIN_FEATURES,
  ADMIN_NAVIGATION_SECTIONS,
} from './feature-registry';

export function buildGroupedNavigation() {
  return ADMIN_NAVIGATION_SECTIONS.map((section) => ({
    ...section,
    items: ADMIN_FEATURES.filter(
      (feature) => feature.section === section.key,
    ).map(({ key, label }) => ({ key, label })),
  }));
}

export function buildLegacyNavigation() {
  return ADMIN_FEATURES.map(({ key, label }) => ({ key, label }));
}
