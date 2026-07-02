#!/usr/bin/env bash
set -euo pipefail

export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:15432/community_selection?schema=public}"
export PORT="${PORT:-13080}"
export ADMIN_TOKEN="${ADMIN_TOKEN:-dev-admin-token}"
export ADMIN_AUTH_ENABLED="${ADMIN_AUTH_ENABLED:-false}"
export ADMIN_AUTH_MODE="${ADMIN_AUTH_MODE:-token}"
export WECHAT_PAY_MODE="${WECHAT_PAY_MODE:-mock}"
export MOCK_WECHAT_PAY="${MOCK_WECHAT_PAY:-true}"
export AUTO_PAYOUT_ENABLED="${AUTO_PAYOUT_ENABLED:-false}"
export AUTO_TAX_FILING_ENABLED="${AUTO_TAX_FILING_ENABLED:-false}"

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
pnpm exec tsx scripts/verify-report-publish-local.ts
pnpm exec tsx scripts/verify-l10-security-local.ts
pnpm exec tsx scripts/verify-l11-admin-auth-local.ts
pnpm exec tsx scripts/verify-l12-fulfillment-local.ts
pnpm exec tsx scripts/verify-l13-inventory-purchase-local.ts
pnpm exec tsx scripts/verify-l14-batch-supplier-loss-local.ts
pnpm exec tsx scripts/verify-l14-5-modular-boundary-local.ts
scripts/verify-l1-l2-l3-local.sh
pnpm exec tsx scripts/verify-l4-admin-basic-local.ts
scripts/verify-l1-l2-l3-l4-l5-l6-l7-local.sh
scripts/verify-l1-l2-l3-l4-l5-l6-l7-logs-local.sh
scripts/verify-l1-l2-l3-l4-l5-l6-l7-l8-local.sh
scripts/verify-l1-l2-l3-l4-l5-l6-l7-l8-l9-local.sh
