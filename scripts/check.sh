#!/usr/bin/env bash
set -euo pipefail

# Codex 阶段 1 需要补齐 package scripts 后，让本脚本真正可运行。
# 目标命令：
# pnpm install
# pnpm db:generate
# pnpm typecheck
# pnpm lint
# pnpm test
# pnpm build

if [ ! -f package.json ]; then
  echo "package.json not found. Run Codex stage 1 first."
  exit 1
fi

pnpm install
pnpm db:generate || true
pnpm typecheck
pnpm lint
pnpm test
pnpm build
