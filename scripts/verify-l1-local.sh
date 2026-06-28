#!/usr/bin/env bash
set -euo pipefail

FULL=0
REGISTRY="${REGISTRY:-}"
PACKAGE="${PACKAGE:-antd}"
REGISTRIES=(
  "https://registry.npmjs.org/"
  "https://registry.yarnpkg.com/"
  "https://mirrors.cloud.tencent.com/npm/"
  "https://registry.npmmirror.com/"
)

usage() {
  cat <<'USAGE'
Usage:
  scripts/verify-l1-local.sh [--full]

Environment overrides:
  REGISTRY=https://your-registry.example.com/  Test one registry first and use it for --full.
  PACKAGE=antd                                Package used for registry smoke test.

What it checks:
  1. Local Node/pnpm availability.
  2. Registry reachability with curl and pnpm view.
  3. L1 boundary static checks: no L2 db scripts, no local absolute paths, no npm tokens.
  4. Optional --full: run pnpm install, db:generate, typecheck, lint, test, build.
USAGE
}

for arg in "$@"; do
  case "$arg" in
    --full) FULL=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $arg" >&2; usage; exit 2 ;;
  esac
done

section() {
  printf '\n== %s ==\n' "$1"
}

check_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

normalize_registry() {
  local registry="$1"
  if [[ "$registry" != */ ]]; then
    registry="$registry/"
  fi
  printf '%s' "$registry"
}

try_registry() {
  local registry
  registry=$(normalize_registry "$1")
  local url="${registry%/}/$PACKAGE"
  echo "-- $registry"

  local curl_status
  curl_status=$(curl -I -L --max-time 20 --silent --show-error --output /dev/null --write-out '%{http_code}' "$url" 2>&1 || true)
  echo "curl $PACKAGE: $curl_status"

  if timeout 30 pnpm view "$PACKAGE" version --registry="$registry" >/tmp/l1-pnpm-view.out 2>/tmp/l1-pnpm-view.err; then
    local version
    version=$(cat /tmp/l1-pnpm-view.out)
    echo "pnpm view $PACKAGE: ok ($version)"
    rm -f /tmp/l1-pnpm-view.out /tmp/l1-pnpm-view.err
    SELECTED_REGISTRY="$registry"
    return 0
  fi

  echo "pnpm view $PACKAGE: failed"
  sed -n '1,8p' /tmp/l1-pnpm-view.err
  rm -f /tmp/l1-pnpm-view.out /tmp/l1-pnpm-view.err
  return 1
}

check_command node
check_command pnpm
check_command curl

section "Runtime"
echo "node: $(node --version)"
echo "pnpm: $(pnpm --version)"
echo "project registry: $(pnpm config get registry 2>/dev/null || true)"
echo "HTTP_PROXY: ${HTTP_PROXY:-}"
echo "HTTPS_PROXY: ${HTTPS_PROXY:-}"

section "Registry smoke"
SELECTED_REGISTRY=""
if [ -n "$REGISTRY" ]; then
  try_registry "$REGISTRY" || true
fi

if [ -z "$SELECTED_REGISTRY" ]; then
  for registry in "${REGISTRIES[@]}"; do
    if try_registry "$registry"; then
      break
    fi
  done
fi

if [ -z "$SELECTED_REGISTRY" ]; then
  cat <<'RESULT'

No tested registry is reachable from this environment.
Next options:
  - Allow npm/yarn/Tencent/npmmirror through the proxy/firewall.
  - Provide an internal registry and rerun with REGISTRY=https://your-registry/.
  - Provide pnpm-lock.yaml plus a mounted pnpm store cache.
RESULT
  exit 1
fi

echo "Selected registry: $SELECTED_REGISTRY"

section "L1 boundary static checks"
node scripts/lint-placeholder.js
if rg -n '"db:(migrate|seed|studio)"|seed\.ts' package.json prisma scripts; then
  echo "L2 database script/seed found; stop." >&2
  exit 1
fi
if rg -n '(_authToken|//.*:_authToken|npm_[A-Za-z0-9]|/root/|/Users/|C:\\)' .npmrc package.json scripts; then
  echo "Token or local absolute path found; stop." >&2
  exit 1
fi
echo "L1 boundary static checks passed."

if [ "$FULL" -ne 1 ]; then
  cat <<RESULT

Registry smoke and L1 static checks passed.
To run the full L1 pipeline locally:
  REGISTRY=$SELECTED_REGISTRY scripts/verify-l1-local.sh --full
RESULT
  exit 0
fi

section "Full L1 pipeline"
pnpm install --registry="$SELECTED_REGISTRY"
pnpm db:generate
pnpm typecheck
pnpm lint
pnpm test
pnpm build

echo "Full L1 pipeline passed."
