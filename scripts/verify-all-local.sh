#!/usr/bin/env bash
set -euo pipefail
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
scripts/verify-l1-l2-l3-local.sh
scripts/verify-l1-l2-l3-l4-l5-l6-l7-local.sh
scripts/verify-l1-l2-l3-l4-l5-l6-l7-logs-local.sh
scripts/verify-l1-l2-l3-l4-l5-l6-l7-l8-local.sh
scripts/verify-l1-l2-l3-l4-l5-l6-l7-l8-l9-local.sh
