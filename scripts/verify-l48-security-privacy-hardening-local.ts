import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  L48_ALLOWED_CHANGED_PATHS,
  L48_BUSINESS_BASE_COMMIT,
  L48_FORBIDDEN_CHANGED_PATHS,
  L48_MINIMUM_CURRENT_USER_ROUTES,
  L48_PROHIBITED_RESPONSE_KEYS,
  L48_RUNTIME_MARKERS,
  isL48AllowedChangedPath,
} from './l48-security-privacy-contract.ts';

const repoRoot = process.cwd();
const routesRoot = join(repoRoot, 'apps/api/src/routes');
const routeRegistrationPattern = /app\.(get|post|put|patch|delete)\s*\(\s*(["'`])(\/api\/[^"'`]+)\2/g;

type DiscoveredRoute = {
  file: string;
  method: string;
  path: string;
  block: string;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function readRequired(relativePath: string): string {
  const absolutePath = join(repoRoot, relativePath);
  assert(existsSync(absolutePath), `Missing L48 file: ${relativePath}`);
  return readFileSync(absolutePath, 'utf8');
}

function changedFiles(): string[] {
  const output = execFileSync(
    'git',
    ['diff', '--name-only', `${L48_BUSINESS_BASE_COMMIT}...HEAD`],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  return output.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function routeSourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...routeSourceFiles(absolutePath));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.spec.ts') || entry.name.endsWith('.d.ts')) continue;
    files.push(absolutePath);
  }
  return files;
}

function isCurrentUserPath(path: string): boolean {
  return path === '/api/me' || path.startsWith('/api/me/') || path === '/api/leaders/me' || path.startsWith('/api/leaders/me/');
}

function discoverCurrentUserRoutes(): DiscoveredRoute[] {
  const routes: DiscoveredRoute[] = [];
  for (const absolutePath of routeSourceFiles(routesRoot)) {
    const source = readFileSync(absolutePath, 'utf8');
    const matches = Array.from(source.matchAll(routeRegistrationPattern));
    for (let index = 0; index < matches.length; index += 1) {
      const match = matches[index];
      const path = match[3];
      if (!isCurrentUserPath(path)) continue;
      const start = match.index ?? 0;
      const end = matches[index + 1]?.index ?? source.length;
      routes.push({
        file: relative(repoRoot, absolutePath).replaceAll('\\', '/'),
        method: match[1].toUpperCase(),
        path,
        block: source.slice(start, end),
      });
    }
  }
  return routes;
}

function verifyContract(): void {
  assert(L48_BUSINESS_BASE_COMMIT.length === 40, 'L48 business base commit must be a full SHA');
  assert(L48_RUNTIME_MARKERS.length === 10, 'L48 must define exactly ten runtime markers');
  assert(new Set(L48_RUNTIME_MARKERS).size === L48_RUNTIME_MARKERS.length, 'L48 runtime markers must be unique');
  assert(L48_PROHIBITED_RESPONSE_KEYS.includes('receiver_name'), 'L48 response privacy contract must prohibit raw receiver_name');
  assert(L48_PROHIBITED_RESPONSE_KEYS.includes('manual_reference'), 'L48 response privacy contract must prohibit raw manual_reference');
  assert(L48_ALLOWED_CHANGED_PATHS.length > 0, 'L48 changed-path allow-list must not be empty');
}

function verifyCurrentUserRouteBlocks(): void {
  const routes = discoverCurrentUserRoutes();
  assert(
    routes.length >= L48_MINIMUM_CURRENT_USER_ROUTES.length,
    `Expected at least ${L48_MINIMUM_CURRENT_USER_ROUTES.length} current-user routes, found ${routes.length}`,
  );

  for (const expected of L48_MINIMUM_CURRENT_USER_ROUTES) {
    assert(
      routes.some((route) => route.method === expected.method && route.path === expected.path),
      `Missing current-user route: ${expected.method} ${expected.path}`,
    );
  }

  for (const route of routes) {
    const label = `${route.method} ${route.path} (${route.file})`;
    assert(
      route.block.includes('withCurrentUser(') || route.block.includes('withCurrentLeader('),
      `Current-user route does not use shared wrapper: ${label}`,
    );
    assert(!route.block.includes('resolveUserIdentity'), `Legacy identity resolver remains: ${label}`);
    assert(!route.block.includes('resolveCurrentLeader(request)'), `Legacy leader resolver remains: ${label}`);
    assert(!/statusCode\s*\?\?\s*400/.test(route.block), `Unknown error defaults to 400: ${label}`);
    assert(
      !/fail\(\s*error instanceof Error\s*\?\s*error\.message/.test(route.block),
      `Raw error message is returned: ${label}`,
    );
  }
}

function verifyRequiredArchitecture(): void {
  const securityCore = readRequired('apps/api/src/modules/current-user/current-user-security.ts');
  const securityCoreTests = readRequired('apps/api/src/modules/current-user/current-user-security.test.ts');
  const routeWrapper = readRequired('apps/api/src/routes/current-user-route.ts');
  const routeWrapperTests = readRequired('apps/api/src/routes/current-user-route.test.ts');
  const orderSecurityTests = readRequired('apps/api/src/routes/me/orders-security.test.ts');
  const withdrawalSecurityTests = readRequired('apps/api/src/routes/leader-withdrawals-security.test.ts');
  const rewardSecurityTests = readRequired('apps/api/src/routes/leader-reward-conversion-security.test.ts');
  const httpLogPrivacy = readRequired('apps/api/src/services/http-log-privacy.ts');
  const httpLogPrivacyTests = readRequired('apps/api/src/services/http-log-privacy.test.ts');
  const businessLogPrivacyTests = readRequired('apps/api/src/services/logging-service-privacy.test.ts');
  const dockerE2E = readRequired('scripts/verify-l48-security-privacy-docker-e2e-local.ts');
  readRequired('scripts/run-l48-security-privacy-docker-e2e-local.ts');

  assert(securityCore.includes('export async function resolveCurrentUser'), 'Shared current-user resolver missing');
  assert(securityCore.includes('export function requireCurrentLeader'), 'Shared leader role guard missing');
  assert(securityCore.includes('export function mapCurrentUserRouteError'), 'Shared safe error mapper missing');
  assert(securityCore.includes("headers['x-user-id']") && securityCore.includes("headers['x-openid']"), 'Identity core must read only approved headers');
  assert(routeWrapper.includes('export async function withCurrentUser'), 'withCurrentUser wrapper missing');
  assert(routeWrapper.includes('export async function withCurrentLeader'), 'withCurrentLeader wrapper missing');
  assert(routeWrapper.includes('safeErrorLogMetadata'), 'Wrapper must use safe error metadata');
  assert(securityCoreTests.includes('query-only identity'), 'Core query-only identity regression test missing');
  assert(routeWrapperTests.includes('fixed 500'), 'Wrapper unknown-error regression test missing');
  assert(orderSecurityTests.includes('query-only'), 'Order identity regression test missing');
  assert(withdrawalSecurityTests.includes('query-only'), 'Withdrawal identity regression test missing');
  assert(rewardSecurityTests.includes('leader_user_id'), 'Reward ownership regression test missing');
  assert(httpLogPrivacy.includes('serializeHttpRequest'), 'HTTP request privacy serializer missing');
  assert(httpLogPrivacyTests.includes('unique-marker'), 'HTTP log unique-marker test missing');
  assert(businessLogPrivacyTests.includes('unique-db-host-secret'), 'Business log fallback privacy test missing');
  assert(dockerE2E.includes('L48_PROHIBITED_RESPONSE_KEYS'), 'Docker E2E must scan response keys');
  for (const marker of L48_RUNTIME_MARKERS) {
    assert(dockerE2E.includes(marker), `Docker E2E missing runtime marker: ${marker}`);
  }
}

function verifyChangedFiles(): void {
  const files = changedFiles();
  assert(files.length > 0, 'L48 changed-file list must not be empty');
  for (const file of files) {
    assert(
      !L48_FORBIDDEN_CHANGED_PATHS.includes(file as (typeof L48_FORBIDDEN_CHANGED_PATHS)[number]),
      `L48 forbidden file changed: ${file}`,
    );
    assert(!file.startsWith('prisma/migrations/'), `L48 must not add migrations: ${file}`);
    assert(!file.startsWith('reports/'), `L48 business branch must not contain reports: ${file}`);
    assert(!file.startsWith('.tmp/'), `L48 business branch must not contain .tmp artifacts: ${file}`);
    assert(isL48AllowedChangedPath(file), `L48 changed file is outside approved scope: ${file}`);
  }
}

verifyContract();
verifyCurrentUserRouteBlocks();
verifyRequiredArchitecture();
verifyChangedFiles();

console.log('L48 security and privacy hardening verification passed.');
