export const L48_BUSINESS_BASE_BRANCH = 'stable/l47-business-base';
export const L48_BUSINESS_BASE_COMMIT = '030d06aebe75373600338a2eff92f4fb8e25a607';

export const L48_MINIMUM_CURRENT_USER_ROUTES = [
  { method: 'GET', path: '/api/me/center-summary' },
  { method: 'GET', path: '/api/me/orders' },
  { method: 'GET', path: '/api/me/orders/:id' },
  { method: 'GET', path: '/api/me/orders/:id/after-sales' },
  { method: 'POST', path: '/api/me/orders/:id/after-sales' },
  { method: 'GET', path: '/api/me/orders/:id/pickup-code' },
  { method: 'GET', path: '/api/leaders/me/center-summary' },
  { method: 'GET', path: '/api/leaders/me/commissions' },
  { method: 'GET', path: '/api/leaders/me/withdrawals' },
  { method: 'GET', path: '/api/leaders/me/withdrawals/:id' },
  { method: 'GET', path: '/api/leaders/me/withdrawable-commissions' },
  { method: 'POST', path: '/api/leaders/me/withdrawals' },
  { method: 'POST', path: '/api/leaders/me/rewards/convert-credit' },
] as const;

export const L48_PROHIBITED_RESPONSE_KEYS = [
  'openid',
  'unionid',
  'phone',
  'receiver_name',
  'receiver_phone',
  'receiver_address',
  'bank_account',
  'bank_account_no',
  'account_number',
  'manual_reference',
  'tax_remark',
  'admin_remark',
  'reviewed_by_admin_id',
  'processed_by_admin_id',
] as const;

export const L48_RUNTIME_MARKERS = [
  'l48_query_only_identity_rejected=true',
  'l48_header_identity_wins=true',
  'l48_inactive_user_forbidden=true',
  'l48_non_leader_forbidden=true',
  'l48_reward_owner_scope_verified=true',
  'l48_withdrawal_owner_scope_verified=true',
  'l48_response_privacy_verified=true',
  'l48_http_log_privacy_verified=true',
  'l48_business_log_privacy_verified=true',
  'l48_unknown_error_sanitized=true',
] as const;

export const L48_FORBIDDEN_CHANGED_PATHS = [
  'package.json',
  'pnpm-lock.yaml',
  'prisma/schema.prisma',
] as const;

export const L48_ALLOWED_CHANGED_PATHS = [
  'apps/api/src/app.ts',
  'apps/api/src/modules/current-user/',
  'apps/api/src/modules/me-center/me-center-route-security.ts',
  'apps/api/src/modules/me-center/me-center-routes.test.ts',
  'apps/api/src/modules/user-orders/user-order-service.ts',
  'apps/api/src/routes/commissions.ts',
  'apps/api/src/routes/current-user-route.ts',
  'apps/api/src/routes/current-user-route.test.ts',
  'apps/api/src/routes/leader-commissions-security.test.ts',
  'apps/api/src/routes/leader-reward-conversion-security.test.ts',
  'apps/api/src/routes/leader-withdrawals-security.test.ts',
  'apps/api/src/routes/leaders/center.ts',
  'apps/api/src/routes/me/center.ts',
  'apps/api/src/routes/me/orders-security.test.ts',
  'apps/api/src/routes/me/orders.ts',
  'apps/api/src/routes/rewards.ts',
  'apps/api/src/routes/withdrawals.ts',
  'apps/api/src/services/http-log-privacy.test.ts',
  'apps/api/src/services/http-log-privacy.ts',
  'apps/api/src/services/logging-service-privacy.test.ts',
  'apps/api/src/services/logging-service.ts',
  'docs/reviews/l48-security-privacy-hardening.md',
  'docs/superpowers/plans/2026-07-19-l48-security-privacy-hardening-self-review.md',
  'docs/superpowers/plans/2026-07-19-l48-security-privacy-hardening.md',
  'docs/superpowers/specs/2026-07-19-l48-security-privacy-hardening-design.md',
  'scripts/generate-stage-report-entry.ts',
  'scripts/l48-report-evidence-hook.ts',
  'scripts/l48-security-privacy-contract.ts',
  'scripts/publish-stage-report.ts',
  'scripts/run-l48-security-privacy-docker-e2e-local.ts',
  'scripts/stage-registry.ts',
  'scripts/stage-workflow.ts',
  'scripts/verify-docker-api-e2e-local.ts',
  'scripts/verify-l43-reward-ledger-t3-refund-deduct-local.ts',
  'scripts/verify-l44-manual-withdrawal-review-local.ts',
  'scripts/verify-l47-miniapp-profile-leader-center-local.ts',
  'scripts/verify-l48-report-publish-local.ts',
  'scripts/verify-l48-report-routing-local.ts',
  'scripts/verify-l48-security-privacy-docker-e2e-local.ts',
  'scripts/verify-l48-security-privacy-hardening-local.ts',
  'scripts/verify-report-source-resolver-local.ts',
  'scripts/verify-stage-registry-local.ts',
  'scripts/verify-stage-verifier-architecture-local.ts',
] as const;

export function isL48AllowedChangedPath(path: string): boolean {
  return L48_ALLOWED_CHANGED_PATHS.some((allowed) =>
    allowed.endsWith('/') ? path.startsWith(allowed) : path === allowed,
  );
}

export function findProhibitedResponsePaths(
  value: unknown,
  path = '$',
): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      findProhibitedResponsePaths(item, `${path}[${index}]`),
    );
  }
  if (!value || typeof value !== 'object') return [];

  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, child]) => [
      ...(L48_PROHIBITED_RESPONSE_KEYS.includes(
        key as (typeof L48_PROHIBITED_RESPONSE_KEYS)[number],
      )
        ? [`${path}.${key}`]
        : []),
      ...findProhibitedResponsePaths(child, `${path}.${key}`),
    ],
  );
}
