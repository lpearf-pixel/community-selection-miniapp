#!/usr/bin/env bash
set -euo pipefail

PNPM_CLI="${PNPM_CLI:-/root/.nvm/versions/node/v24.15.0/lib/node_modules/pnpm/bin/pnpm.cjs}"
pnpm() {
  COREPACK_ENABLE_PROJECT_SPEC=0 node "$PNPM_CLI" "$@"
}

pnpm install
pnpm db:generate
pnpm typecheck
pnpm lint
pnpm test
pnpm build
