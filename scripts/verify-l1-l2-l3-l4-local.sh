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

echo "Using DATABASE_URL=$DATABASE_URL"

pnpm exec tsx scripts/verify-l1-l2-l3-l4-local.ts
