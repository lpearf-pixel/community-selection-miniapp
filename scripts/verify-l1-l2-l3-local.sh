#!/usr/bin/env bash
set -euo pipefail

API_PID=""
API_STARTED=0

cleanup() {
  if [ "$API_STARTED" = "1" ] && [ -n "$API_PID" ]; then
    kill "$API_PID" >/dev/null 2>&1 || true
    wait "$API_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

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

print_port_owner() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN || true
    return
  fi
  if command -v ss >/dev/null 2>&1; then
    ss -ltnp "sport = :$port" || true
    return
  fi
  echo "No lsof/ss available to print the process using port $port."
}

port_in_use() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi
  if command -v ss >/dev/null 2>&1; then
    ss -ltn "sport = :$port" | grep -q LISTEN
    return $?
  fi
  node -e "require('node:net').createServer().once('error',()=>process.exit(0)).once('listening',function(){this.close(()=>process.exit(1))}).listen(Number(process.argv[1]), '127.0.0.1')" "$port"
}

wait_for_url() {
  local url="$1"
  for _ in $(seq 1 60); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "Timed out waiting for $url" >&2
  return 1
}

json_get() {
  local url="$1"
  curl -fsS "$url"
}

extract_first_product_id() {
  node -e '
const fs = require("node:fs");
const body = JSON.parse(fs.readFileSync(0, "utf8"));
const data = body.data;
const list = Array.isArray(data) ? data : (data?.items || data?.list || data?.products || data?.rows || []);
if (!body.success || !Array.isArray(list) || list.length === 0 || !list[0].id) process.exit(1);
console.log(list[0].id);
'
}

assert_success_response() {
  node -e '
const fs = require("node:fs");
const body = JSON.parse(fs.readFileSync(0, "utf8"));
if (body.success !== true || !("data" in body) || body.message !== "") {
  console.error("Unexpected API envelope", body);
  process.exit(1);
}
'
}

assert_seed_counts() {
  pnpm exec tsx -e '
import { PrismaClient, UserRole } from "@prisma/client";
const prisma = new PrismaClient();
const [categories, products, communities, pickupStores, admins] = await Promise.all([
  prisma.category.count(),
  prisma.product.count(),
  prisma.community.count(),
  prisma.pickupStore.count(),
  prisma.user.count({ where: { role: UserRole.admin } })
]);
await prisma.$disconnect();
const checks = [
  ["Category", categories, 5],
  ["Product", products, 10],
  ["Community", communities, 3],
  ["PickupStore", pickupStores, 1],
  ["admin user", admins, 1]
];
for (const [name, actual, min] of checks) {
  if (actual < min) {
    console.error(`${name} count ${actual} < ${min}`);
    process.exit(1);
  }
}
console.log("Seed counts passed", { categories, products, communities, pickupStores, admins });
'
}

load_env
API_PORT="${PORT:-13080}"
DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:15432/community_selection?schema=public}"
export DATABASE_URL

echo "Using API_PORT=$API_PORT"
echo "Using DATABASE_URL=$DATABASE_URL"

if port_in_use "$API_PORT"; then
  echo "API port $API_PORT is already in use. Refusing to kill user processes." >&2
  print_port_owner "$API_PORT"
  exit 1
fi

if docker compose ps --status running --services 2>/dev/null | grep -qx postgres; then
  echo "Reusing running docker compose postgres service."
else
  docker compose up -d postgres
fi

pnpm install
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm typecheck
pnpm lint
pnpm test
pnpm build

assert_seed_counts

pnpm --dir apps/api exec tsx src/server.ts &
API_PID=$!
API_STARTED=1
wait_for_url "http://localhost:$API_PORT/health"

json_get "http://localhost:$API_PORT/health" | assert_success_response
json_get "http://localhost:$API_PORT/api/categories" | assert_success_response
products_json=$(json_get "http://localhost:$API_PORT/api/products")
printf '%s' "$products_json" | assert_success_response
product_id=$(printf '%s' "$products_json" | extract_first_product_id)
json_get "http://localhost:$API_PORT/api/products/$product_id" | assert_success_response
json_get "http://localhost:$API_PORT/api/communities" | assert_success_response
json_get "http://localhost:$API_PORT/api/pickup-stores" | assert_success_response

echo "L1/L2/L3 local verification passed."
