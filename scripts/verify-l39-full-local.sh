#!/usr/bin/env bash
set -e
set -o pipefail

LOG_DIR="reports/L39"
LOG_FILE="${LOG_DIR}/manual-verify.log"
mkdir -p "${LOG_DIR}"
: > "${LOG_FILE}"

run_step() {
  echo "\n=== $* ===" | tee -a "${LOG_FILE}"
  "$@" 2>&1 | tee -a "${LOG_FILE}"
}

if [ ! -f "scripts/verify-l39-delivery-refund-finance-baseline-local.ts" ]; then
  echo "Missing L39 verifier: scripts/verify-l39-delivery-refund-finance-baseline-local.ts" | tee -a "${LOG_FILE}"
  exit 1
fi

run_step pnpm exec tsx scripts/verify-no-raw-compliance-terms-local.ts
run_step pnpm exec tsx scripts/verify-l39-delivery-refund-finance-baseline-local.ts
run_step pnpm exec tsx scripts/verify-docker-api-e2e-local.ts
run_step pnpm --filter @community-selection/admin exec tsc -p tsconfig.json --noEmit --pretty false
run_step pnpm exec tsx scripts/stage-workflow.ts --stage=L39 --verify --scope=chain

echo "\nL39 full local verification passed." | tee -a "${LOG_FILE}"
