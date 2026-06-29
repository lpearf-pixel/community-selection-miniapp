#!/usr/bin/env bash
set -euo pipefail

load_env() {
  if [ -f .env ]; then
    set -a
    # shellcheck disable=SC1091
    . ./.env
    set +a
  elif [ -f .env.example ]; then
    set -a
    # shellcheck disable=SC1091
    . ./.env.example
    set +a
  fi
}

load_env
export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:15432/community_selection?schema=public}"
export WECHAT_PAY_MODE="${WECHAT_PAY_MODE:-mock}"
export MOCK_WECHAT_PAY="${MOCK_WECHAT_PAY:-true}"

echo "Using DATABASE_URL=$DATABASE_URL"
echo "Using WECHAT_PAY_MODE=$WECHAT_PAY_MODE"

pnpm exec tsx scripts/verify-l1-l2-l3-l4-l5-local.ts
