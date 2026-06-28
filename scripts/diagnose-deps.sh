#!/usr/bin/env bash
set -u -o pipefail

registries=(
  "https://registry.npmjs.org/"
  "https://registry.yarnpkg.com/"
  "https://mirrors.cloud.tencent.com/npm/"
  "https://registry.npmmirror.com/"
)
packages=("antd" "react" "vite" "fastify" "typescript" "prisma" "vitest")

echo "== Environment =="
echo "node=$(node --version 2>/dev/null || true)"
echo "pnpm=$(pnpm --version 2>/dev/null || true)"
echo "HTTP_PROXY=${HTTP_PROXY:-}"
echo "HTTPS_PROXY=${HTTPS_PROXY:-}"
echo "npm_config_http_proxy=${npm_config_http_proxy:-}"
echo "npm_config_https_proxy=${npm_config_https_proxy:-}"
echo "NO_PROXY=${NO_PROXY:-}"
echo

echo "== Project registry =="
pnpm config get registry 2>/dev/null || true
echo

echo "== Registry access through current proxy =="
for registry in "${registries[@]}"; do
  echo "-- $registry"
  for pkg in "${packages[@]}"; do
    url="${registry%/}/$pkg"
    status=$(curl -I -L --max-time 10 --silent --show-error --output /dev/null --write-out '%{http_code}' "$url" 2>&1 || true)
    echo "$pkg $status"
    break
  done
done
echo

echo "== Registry access without proxy =="
for registry in "${registries[@]}"; do
  echo "-- $registry"
  url="${registry%/}/antd"
  status=$(env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy -u npm_config_http_proxy -u npm_config_https_proxy \
    curl -I -L --max-time 10 --silent --show-error --output /dev/null --write-out '%{http_code}' "$url" 2>&1 || true)
  echo "antd $status"
done
echo

echo "== pnpm view smoke through current proxy =="
for registry in "${registries[@]}"; do
  echo "-- $registry"
  timeout 15 pnpm view antd version --registry="$registry" 2>&1 | sed -n '1,8p'
done
echo

echo "== Internal registry hints =="
if env | grep -Ei '(^|_)(NPM|PNPM|REGISTRY|VERDACCIO|ARTIFACTORY|NEXUS)' | grep -Ev 'TOKEN|AUTH|PASSWORD|SECRET' >/tmp/registry-env.txt; then
  cat /tmp/registry-env.txt
else
  echo "No internal registry environment variable found."
fi
rm -f /tmp/registry-env.txt
echo

echo "== Lockfile and pnpm store =="
if [ -f pnpm-lock.yaml ]; then
  echo "pnpm-lock.yaml exists"
else
  echo "pnpm-lock.yaml missing"
fi
store_path=$(pnpm store path 2>/dev/null | tail -n 1 || true)
echo "pnpm store path: $store_path"
if [ -n "$store_path" ] && [ -d "$store_path" ]; then
  store_files=$(find "$store_path" -maxdepth 3 -type f 2>/dev/null | head -20)
  if [ -n "$store_files" ]; then
    echo "$store_files"
  else
    echo "pnpm store exists but no cached package files were found at maxdepth 3"
  fi
else
  echo "pnpm store path not available"
fi
echo

echo "== CI hints =="
if [ -d .github/workflows ]; then
  find .github/workflows -maxdepth 1 -type f -print
else
  echo ".github/workflows missing"
fi
