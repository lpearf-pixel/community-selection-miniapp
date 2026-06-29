#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:15432/community_selection?schema=public}"
export WECHAT_PAY_MODE="${WECHAT_PAY_MODE:-mock}"
export MOCK_WECHAT_PAY="${MOCK_WECHAT_PAY:-true}"

echo "Using DATABASE_URL=$DATABASE_URL"
echo "Using WECHAT_PAY_MODE=$WECHAT_PAY_MODE"

pnpm exec tsx scripts/verify-l1-l2-l3-l4-l5-l6-l7-logs-local.ts
