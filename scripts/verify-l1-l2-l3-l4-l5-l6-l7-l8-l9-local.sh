#!/usr/bin/env bash
set -euo pipefail
export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:15432/community_selection?schema=public}"
export WECHAT_PAY_MODE="${WECHAT_PAY_MODE:-mock}"
echo "Using DATABASE_URL=${DATABASE_URL}"
echo "Using WECHAT_PAY_MODE=${WECHAT_PAY_MODE}"
scripts/verify-l1-l2-l3-l4-l5-l6-l7-l8-local.sh
pnpm exec tsx scripts/verify-l1-l2-l3-l4-l5-l6-l7-l8-l9-local.ts
