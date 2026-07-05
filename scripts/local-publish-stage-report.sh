#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

STAGE="${1:-L15}"

export API_PORT="${API_PORT:-13080}"
export API_HOST="${API_HOST:-127.0.0.1}"
export API_BASE_URL="${API_BASE_URL:-http://127.0.0.1:${API_PORT}}"
export NO_PROXY="${NO_PROXY:-localhost,127.0.0.1,::1}"
export no_proxy="${no_proxy:-localhost,127.0.0.1,::1}"

if [ ! -f reports/latest-verify-output.txt ]; then
  echo "reports/latest-verify-output.txt not found. Run scripts/local-verify.sh first." >&2
  exit 1
fi

pnpm report:publish -- --stage="${STAGE}" --push
