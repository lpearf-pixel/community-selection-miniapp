#!/usr/bin/env bash
set -euo pipefail

pnpm install --frozen-lockfile
pnpm db:generate
pnpm typecheck
pnpm lint
pnpm test
pnpm build
