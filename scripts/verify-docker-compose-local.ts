import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

function readRequired(path: string): string {
  const file = resolve(process.cwd(), path);
  if (!existsSync(file)) {
    throw new Error(`${path} does not exist`);
  }
  return readFileSync(file, 'utf8');
}

function assertContains(content: string, needle: string, label: string): void {
  if (!content.includes(needle)) {
    throw new Error(`${label} must contain: ${needle}`);
  }
}

function assertNotContains(content: string, needle: string, label: string): void {
  if (content.includes(needle)) {
    throw new Error(`${label} must not contain: ${needle}`);
  }
}

function assertBefore(content: string, earlier: string, later: string, label: string): void {
  const earlierIndex = content.indexOf(earlier);
  const laterIndex = content.indexOf(later);
  if (earlierIndex === -1 || laterIndex === -1 || earlierIndex >= laterIndex) {
    throw new Error(`${label} must run ${earlier} before ${later}`);
  }
}

function getServiceBlock(compose: string, serviceName: 'api' | 'admin'): string {
  const nextService = serviceName === 'api' ? '\n  admin:' : '\nvolumes:';
  const start = compose.indexOf(`\n  ${serviceName}:`);
  const end = compose.indexOf(nextService, start + 1);
  if (start === -1 || end === -1) {
    throw new Error(`docker-compose.yml must contain ${serviceName} service block`);
  }
  return compose.slice(start, end);
}

const compose = readRequired('docker-compose.yml');
const npmrc = readRequired('.npmrc');
const dockerignore = readRequired('.dockerignore');
const docs = readRequired('docs/dev/docker-local.md');
const tsconfig = readRequired('tsconfig.base.json');
const api = getServiceBlock(compose, 'api');
const admin = getServiceBlock(compose, 'admin');

assertContains(compose, 'registry.npmjs.org', 'docker-compose.yml');
assertNotContains(compose, 'registry.yarnpkg.com', 'docker-compose.yml');
assertContains(compose, 'verify-store-integrity false', 'docker-compose.yml');
assertContains(compose, 'store-dir /root/.local/share/pnpm/store', 'docker-compose.yml');
assertContains(compose, 'pnpm --filter @community-selection/shared build', 'docker-compose.yml');
assertContains(compose, 'pnpm --filter @community-selection/config build', 'docker-compose.yml');
assertContains(compose, "import * as m from '@community-selection/shared'", 'docker-compose.yml');
assertContains(compose, 'shared exports ok', 'docker-compose.yml');
assertNotContains(tsconfig, 'packages/shared/dist/index.d.ts', 'tsconfig.base.json');
assertNotContains(tsconfig, 'packages/config/dist/index.d.ts', 'tsconfig.base.json');
assertContains(tsconfig, 'packages/shared/dist/index.js', 'tsconfig.base.json');
assertContains(tsconfig, 'packages/config/dist/index.js', 'tsconfig.base.json');

for (const [label, block] of [['api command', api], ['admin command', admin]] as const) {
  assertContains(block, 'apt-get install -y openssl ca-certificates', label);
  assertContains(block, 'corepack prepare pnpm@9.15.4 --activate', label);
  assertContains(block, 'pnpm config set registry https://registry.npmjs.org/', label);
  assertContains(block, 'pnpm config set verify-store-integrity false', label);
  assertContains(block, 'pnpm config set store-dir /root/.local/share/pnpm/store', label);
  assertContains(block, 'pnpm store prune || true', label);
  assertContains(block, 'pnpm install --force', label);
  assertContains(block, "import * as m from '@community-selection/shared'", label);
  assertContains(block, 'shared exports ok', label);
}

for (const needle of [
  'pnpm --filter @community-selection/shared build',
  'pnpm --filter @community-selection/config build',
  'pnpm db:generate',
  'pnpm db:migrate',
  'pnpm db:seed',
  'pnpm --filter @community-selection/api dev',
]) {
  assertContains(api, needle, 'api command');
}

for (const needle of [
  'pnpm --filter @community-selection/shared build',
  'pnpm --filter @community-selection/config build',
  'pnpm --filter @community-selection/admin dev',
  '--host 0.0.0.0',
  '--port 13081',
]) {
  assertContains(admin, needle, 'admin command');
}


assertBefore(api, 'pnpm --filter @community-selection/shared build', 'pnpm db:generate', 'api command');
assertBefore(api, 'pnpm --filter @community-selection/config build', 'pnpm db:generate', 'api command');
assertBefore(admin, 'pnpm --filter @community-selection/shared build', 'pnpm --filter @community-selection/admin dev', 'admin command');
assertBefore(admin, 'pnpm --filter @community-selection/config build', 'pnpm --filter @community-selection/admin dev', 'admin command');

for (const needle of [
  'api-node-modules:/app/node_modules',
  'admin-node-modules:/app/node_modules',
  'api-pnpm-store:/root/.local/share/pnpm/store',
  'admin-pnpm-store:/root/.local/share/pnpm/store',
]) {
  assertContains(compose, needle, 'docker-compose.yml');
}

for (const needle of ['@esbuild/darwin-arm64', '@rollup/rollup-darwin']) {
  assertNotContains(compose, needle, 'docker-compose.yml');
}

for (const needle of ['registry=https://registry.npmjs.org/', 'verify-store-integrity=false']) {
  assertContains(npmrc, needle, '.npmrc');
}

for (const needle of ['node_modules', '**/node_modules', '.pnpm-store', 'reports']) {
  assertContains(dockerignore, needle, '.dockerignore');
}

for (const needle of [
  'ERR_PNPM_TARBALL_INTEGRITY',
  'c12@3.1.0',
  'registry.npmjs.org',
  'named volumes',
  'OpenSSL',
  '@community-selection/shared',
  '@community-selection/config',
  "does not provide an export named 'fail'",
  'tsx',
  'dist/index.js',
  'dist/index.d.ts',
  '返回空对象',
]) {
  assertContains(docs, needle, 'docs/dev/docker-local.md');
}

console.log('Docker compose local verification passed.');
