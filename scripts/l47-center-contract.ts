export const L47_CENTER_API_CONTRACT = [
  {
    method: 'GET',
    path: '/api/me/center-summary',
    auth: 'current user',
    response_sections: ['profile', 'orders', 'after_sales', 'navigation', 'updated_at'],
  },
  {
    method: 'GET',
    path: '/api/leaders/me/center-summary',
    auth: 'current leader',
    response_sections: ['group_buys', 'rewards', 'withdrawals', 'navigation', 'updated_at'],
  },
] as const;

export const L47_PENDING_AFTER_SALE_STATUSES = ['submitted', 'reviewing', 'approved', 'processing'] as const;
export const L47_PENDING_FULFILLMENT_ORDER_STATUSES = ['paid', 'grouped', 'preparing'] as const;
export const L47_DELIVERY_ACTIVE_ORDER_STATUSES = ['ready', 'delivered'] as const;
export const L47_ACTIVE_GROUP_BUY_STATUSES = ['pending'] as const;
export const L47_SUCCESS_GROUP_BUY_STATUSES = ['success', 'preparing', 'ready', 'fulfilled'] as const;
export const L47_FAILED_GROUP_BUY_STATUSES = ['failed', 'cancelled'] as const;
export const L47_PENDING_COMMISSION_STATUSES = ['estimated', 'frozen', 'pending'] as const;
export const L47_WITHDRAWING_STATUSES = ['pending', 'approved'] as const;
export const L47_PROCESSED_WITHDRAWAL_STATUSES = ['paid'] as const;

export const L47_RUNTIME_MARKERS = [
  'l47_me_center_summary_success=true',
  'l47_me_center_order_counts_verified=true',
  'l47_me_center_after_sale_count_verified=true',
  'l47_leader_center_summary_success=true',
  'l47_leader_group_buy_counts_verified=true',
  'l47_leader_reward_amounts_verified=true',
  'l47_leader_withdrawal_summary_verified=true',
  'l47_non_leader_forbidden=true',
  'l47_sensitive_fields_absent=true',
  'l47_miniapp_navigation_verified=true',
] as const;

export const L47_PROHIBITED_RESPONSE_KEYS = [
  'openid',
  'unionid',
  'phone',
  'receiver_phone',
  'bank_account_no',
  'tax_mode',
  'tax_status',
  'tax_amount_cents',
  'tax_remark',
  'admin_remark',
  'manual_reference',
] as const;

export const L47_FORBIDDEN_CHANGED_PATHS = [
  'package.json',
  'pnpm-lock.yaml',
  'prisma/schema.prisma',
] as const;

export const L47_ALLOWED_CHANGED_PATHS = [
  'apps/api/src/modules/me-center/',
  'apps/api/src/routes/me/center.ts',
  'apps/api/src/routes/leaders/center.ts',
  'apps/api/src/routes/public/index.ts',
  'apps/miniapp/app.json',
  'apps/miniapp/pages/mine/',
  'apps/miniapp/pages/leader/center/',
  'apps/miniapp/utils/api.js',
  'apps/miniapp/utils/center.js',
  'docs/reviews/l47-miniapp-profile-leader-center.md',
  'docs/superpowers/specs/2026-07-18-l47-miniapp-profile-leader-center-design.md',
  'docs/superpowers/plans/2026-07-18-l47-miniapp-profile-leader-center.md',
  'scripts/l47-center-contract.ts',
  'scripts/verify-l47-miniapp-profile-leader-center-local.ts',
  'scripts/verify-l47-center-docker-api-e2e-local.ts',
  'scripts/run-l47-center-docker-api-e2e-local.ts',
  'scripts/verify-docker-api-e2e-local.ts',
  'scripts/stage-registry.ts',
  'scripts/verify-all-local.sh',
  'scripts/generate-stage-report.ts',
  'scripts/verify-report-publish-local.ts',
  'scripts/verify-report-stage-routing-local.ts',
  'scripts/verify-stage-registry-local.ts',
  'scripts/verify-stage-verifier-architecture-local.ts',
] as const;

export function isL47AllowedChangedPath(path: string): boolean {
  return L47_ALLOWED_CHANGED_PATHS.some((allowed) =>
    allowed.endsWith('/') ? path.startsWith(allowed) : path === allowed,
  );
}
