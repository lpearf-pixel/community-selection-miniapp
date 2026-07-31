export const FIRST_LAUNCH_CATEGORY_RULE_VERSION = 'l53-d2-category-v1';

export type FirstLaunchCategoryFailureReason =
  | 'CATEGORY_CODE_MISSING'
  | 'CATEGORY_NOT_ALLOWED';

export type FirstLaunchCategoryDecision =
  | {
      allowed: true;
      reason: null;
      rule_version: typeof FIRST_LAUNCH_CATEGORY_RULE_VERSION;
    }
  | {
      allowed: false;
      reason: FirstLaunchCategoryFailureReason;
      rule_version: typeof FIRST_LAUNCH_CATEGORY_RULE_VERSION;
    };

const ALLOWED_FIRST_LAUNCH_CATEGORY_CODES = new Set([
  'vegetable',
  'fruit',
  'egg',
  'grain',
  'primary_dried_goods',
]);

export function decideFirstLaunchCategory(
  code: string | null | undefined,
): FirstLaunchCategoryDecision {
  const normalized = code?.trim();
  if (!normalized) {
    return {
      allowed: false,
      reason: 'CATEGORY_CODE_MISSING',
      rule_version: FIRST_LAUNCH_CATEGORY_RULE_VERSION,
    };
  }
  if (!ALLOWED_FIRST_LAUNCH_CATEGORY_CODES.has(normalized)) {
    return {
      allowed: false,
      reason: 'CATEGORY_NOT_ALLOWED',
      rule_version: FIRST_LAUNCH_CATEGORY_RULE_VERSION,
    };
  }
  return {
    allowed: true,
    reason: null,
    rule_version: FIRST_LAUNCH_CATEGORY_RULE_VERSION,
  };
}
