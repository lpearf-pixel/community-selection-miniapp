import { existsSync, readFileSync } from 'node:fs';

const composePath = 'docker-compose.yml';
const dockerignorePath = '.dockerignore';

function assertIncludes(content: string, expected: string, label: string): void {
  if (!content.includes(expected)) {
    throw new Error(`${label} is missing: ${expected}`);
  }
}

function assertNotIncludes(content: string, forbidden: string): void {
  if (content.includes(forbidden)) {
    throw new Error(`docker-compose.yml must not contain: ${forbidden}`);
  }
}

if (!existsSync(composePath)) {
  throw new Error('docker-compose.yml does not exist.');
}

const compose = readFileSync(composePath, 'utf8');

for (const required of ['openssl', 'ca-certificates']) {
  assertIncludes(compose, required, 'docker-compose.yml');
}

for (const required of [
  'corepack prepare pnpm@9.15.4 --activate',
  'pnpm install',
  'pnpm db:generate',
  'pnpm db:migrate',
  'pnpm db:seed',
  'pnpm --filter @community-selection/api dev',
]) {
  assertIncludes(compose, required, 'api service command');
}

for (const required of [
  'corepack prepare pnpm@9.15.4 --activate',
  'pnpm install',
  'pnpm --filter @community-selection/admin dev',
  '--host 0.0.0.0',
  '--port 13081',
]) {
  assertIncludes(compose, required, 'admin service command');
}

for (const required of [
  'api-node-modules:/app/node_modules',
  'admin-node-modules:/app/node_modules',
  'api-pnpm-store',
  'admin-pnpm-store',
]) {
  assertIncludes(compose, required, 'docker-compose.yml named volumes');
}

for (const forbidden of ['@esbuild/darwin-arm64', '@rollup/rollup-darwin']) {
  assertNotIncludes(compose, forbidden);
}

if (!existsSync(dockerignorePath)) {
  throw new Error('.dockerignore does not exist.');
}

const dockerignore = readFileSync(dockerignorePath, 'utf8');
for (const required of ['node_modules', '**/node_modules', '.pnpm-store', 'reports']) {
  assertIncludes(dockerignore, required, '.dockerignore');
}

console.log('Docker compose local verification passed.');
