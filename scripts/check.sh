#!/usr/bin/env bash
set -euo pipefail

pnpm install
pnpm db:generate
pnpm typecheck
pnpm lint
pnpm test
pnpm build
