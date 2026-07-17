#!/usr/bin/env bash
set -euo pipefail

export API_PORT="${API_PORT:-${PORT:-13080}}"
export API_HOST="${API_HOST:-127.0.0.1}"
export API_BASE_URL="${API_BASE_URL:-http://127.0.0.1:${API_PORT}}"
export NO_PROXY="${NO_PROXY:-localhost,127.0.0.1,::1}"
export no_proxy="${no_proxy:-localhost,127.0.0.1,::1}"
export PORT="${API_PORT}"
export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:15432/community_selection?schema=public}"
export ADMIN_TOKEN="${ADMIN_TOKEN:-dev-admin-token}"
export ADMIN_AUTH_ENABLED="${ADMIN_AUTH_ENABLED:-false}"
export ADMIN_AUTH_MODE="${ADMIN_AUTH_MODE:-token}"
export WECHAT_PAY_MODE="${WECHAT_PAY_MODE:-mock}"
export MOCK_WECHAT_PAY="${MOCK_WECHAT_PAY:-true}"
export AUTO_PAYOUT_ENABLED="${AUTO_PAYOUT_ENABLED:-false}"
export AUTO_TAX_FILING_ENABLED="${AUTO_TAX_FILING_ENABLED:-false}"

pnpm exec tsx scripts/verify-no-raw-compliance-terms-local.ts

pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm seed:check
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm exec tsx scripts/validate-env.ts
pnpm exec tsx scripts/check-migrations.ts
pnpm exec tsx scripts/compliance-scan.ts

# Report publish verification is Stage-specific. Keep verify:all deterministic by
# running it only when the caller explicitly selects a registered report Stage.
if [[ -n "${REPORT_PUBLISH_STAGE:-}" ]]; then
  REPORT_PUBLISH_STAGE_NORMALIZED="$(printf '%s' "${REPORT_PUBLISH_STAGE}" | tr '[:lower:]' '[:upper:]')"
  case "${REPORT_PUBLISH_STAGE_NORMALIZED}" in
    L46)
      pnpm exec tsx scripts/verify-l46-report-publish-local.ts --stage=L46
      ;;
    *)
      pnpm exec tsx scripts/verify-report-publish-local.ts --stage="${REPORT_PUBLISH_STAGE_NORMALIZED}"
      ;;
  esac
fi

pnpm exec tsx scripts/verify-l10-security-local.ts
pnpm exec tsx scripts/verify-l11-admin-auth-local.ts
pnpm exec tsx scripts/verify-l12-fulfillment-local.ts
pnpm exec tsx scripts/verify-l13-inventory-purchase-local.ts
pnpm exec tsx scripts/verify-l14-batch-supplier-loss-local.ts
pnpm exec tsx scripts/verify-l14-5-modular-boundary-local.ts
pnpm exec tsx scripts/verify-l15-after-sale-local.ts
pnpm exec tsx scripts/verify-l16-finance-reconciliation-local.ts
pnpm exec tsx scripts/verify-l17-operations-dashboard-local.ts
pnpm exec tsx scripts/verify-l17-5-normal-purchase-local.ts
pnpm exec tsx scripts/verify-l18-user-order-center-local.ts
pnpm exec tsx scripts/verify-l19-product-purchase-entry-local.ts
pnpm exec tsx scripts/verify-l20-miniapp-e2e-release-local.ts
pnpm exec tsx scripts/verify-l21-miniapp-location-selection-local.ts
pnpm exec tsx scripts/verify-l22-miniapp-order-center-local.ts
pnpm exec tsx scripts/verify-l23-mvp-release-readiness-local.ts
pnpm exec tsx scripts/run-registered-stage-verifiers.ts --from=L24 --to=L46
