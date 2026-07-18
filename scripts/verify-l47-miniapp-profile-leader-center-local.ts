import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  L47_ALLOWED_CHANGED_PATHS,
  L47_CENTER_API_CONTRACT,
  L47_FORBIDDEN_CHANGED_PATHS,
  L47_PROHIBITED_RESPONSE_KEYS,
  L47_RUNTIME_MARKERS,
  isL47AllowedChangedPath,
} from './l47-center-contract.ts';

const repoRoot = process.cwd();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function readRequired(relativePath: string): string {
  const absolutePath = join(repoRoot, relativePath);
  assert(existsSync(absolutePath), `Missing L47 file: ${relativePath}`);
  return readFileSync(absolutePath, 'utf8');
}

function changedFiles(): string[] {
  const output = execFileSync(
    'git',
    ['diff', '--name-only', 'stable/l46-business-base...HEAD'],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  return output.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function verifyContract(): void {
  assert(L47_CENTER_API_CONTRACT.length === 2, 'L47 must expose exactly two center APIs');
  assert(
    L47_CENTER_API_CONTRACT.some((item) => item.path === '/api/me/center-summary'),
    'L47 personal center contract missing',
  );
  assert(
    L47_CENTER_API_CONTRACT.some((item) => item.path === '/api/leaders/me/center-summary'),
    'L47 leader center contract missing',
  );
  assert(L47_RUNTIME_MARKERS.length === 10, 'L47 must define ten runtime markers');
  assert(new Set(L47_RUNTIME_MARKERS).size === L47_RUNTIME_MARKERS.length, 'L47 runtime markers must be unique');
  assert(L47_PROHIBITED_RESPONSE_KEYS.includes('openid'), 'L47 sensitive-key contract must include openid');
  assert(L47_ALLOWED_CHANGED_PATHS.length > 0, 'L47 changed-path allow-list must not be empty');
}

function verifyBackend(): void {
  const publicRoutes = readRequired('apps/api/src/routes/public/index.ts');
  const meRoute = readRequired('apps/api/src/routes/me/center.ts');
  const leaderRoute = readRequired('apps/api/src/routes/leaders/center.ts');
  const service = readRequired('apps/api/src/modules/me-center/me-center-service.ts');
  const types = readRequired('apps/api/src/modules/me-center/me-center-types.ts');

  assert(/registerMeCenterRoutes\s*\(\s*app\s*\)/.test(publicRoutes), 'Personal center route must be registered');
  assert(/registerLeaderCenterRoutes\s*\(\s*app\s*\)/.test(publicRoutes), 'Leader center route must be registered');
  assert(meRoute.includes('/api/me/center-summary'), 'Personal center endpoint missing');
  assert(leaderRoute.includes('/api/leaders/me/center-summary'), 'Leader center endpoint missing');
  assert(
    leaderRoute.includes('export function assertLeaderRole') &&
      leaderRoute.includes('statusCode: 403') &&
      leaderRoute.includes('assertLeaderRole(user.role)'),
    'Leader role guard missing',
  );
  assert(service.includes('prisma.order.count'), 'Personal center must use database count queries');
  assert(service.includes('prisma.groupBuy.count'), 'Leader center must use database group-buy counts');
  assert(service.includes('prisma.rewardLedger.groupBy'), 'Leader center must aggregate available rewards from the ledger');
  assert(service.includes('take: 5'), 'Leader center latest withdrawals must be limited to five');
  assert(!service.includes('select: { openid: true'), 'Center service must not select openid');
  assert(!service.includes('select: { phone: true'), 'Center service must not select phone');
  assert(types.includes('available_cents: number'), 'Leader reward DTO missing integer-cent field');
  assert(types.includes('leader_center_available: boolean'), 'Personal navigation DTO missing leader-center flag');
}

function verifyMiniapp(): void {
  const appJson = JSON.parse(readRequired('apps/miniapp/app.json')) as { pages?: string[] };
  const mineJs = readRequired('apps/miniapp/pages/mine/index.js');
  const mineWxml = readRequired('apps/miniapp/pages/mine/index.wxml');
  const centerUtils = readRequired('apps/miniapp/utils/center.js');
  const leaderCenterJs = readRequired('apps/miniapp/pages/leader/center/index.js');
  const leaderCenterWxml = readRequired('apps/miniapp/pages/leader/center/index.wxml');

  assert(Array.isArray(appJson.pages), 'Miniapp app.json pages must be an array');
  assert(appJson.pages.includes('pages/leader/center/index'), 'Leader center route missing from app.json');
  assert(appJson.pages.includes('pages/leader/withdrawals/index'), 'Existing withdrawal page must remain registered');
  assert(mineWxml.includes('个人中心'), 'Personal center heading missing');
  assert(!/OpenID/i.test(mineWxml), 'Personal center must not render OpenID');
  assert(mineJs.includes('getMeCenterSummary'), 'Personal center must load the server summary');
  assert(mineJs.includes('leader_center_available'), 'Personal center must gate the leader entry');
  assert(centerUtils.includes('/api/me/center-summary'), 'Miniapp personal center API helper missing');
  assert(centerUtils.includes('/api/leaders/me/center-summary'), 'Miniapp leader center API helper missing');
  assert(leaderCenterJs.includes('/pages/leader/withdrawals/index'), 'Leader center must reuse existing withdrawal page');
  assert(/statusCode\s*===\s*403/.test(leaderCenterJs), 'Leader center must handle non-leader 403 without retrying');
  assert(leaderCenterWxml.includes('本人真实有效团购订单'), 'Leader reward compliance notice missing');
  assert(leaderCenterWxml.includes('后台人工审核'), 'Manual withdrawal notice missing');

  const combinedMiniappSource = [mineJs, mineWxml, centerUtils, leaderCenterJs, leaderCenterWxml]
    .join('\n')
    .replace(/不代表自动到账/g, '')
    .replace(/不会自动到账/g, '');
  assert(!/自动到账|保证收益|拉人计酬|团队收益|排行榜/.test(combinedMiniappSource), 'L47 miniapp contains prohibited growth or payout language');
}

function verifyChangedFiles(): void {
  const files = changedFiles();
  assert(files.length > 0, 'L47 changed-file list must not be empty');
  for (const file of files) {
    assert(!L47_FORBIDDEN_CHANGED_PATHS.includes(file as (typeof L47_FORBIDDEN_CHANGED_PATHS)[number]), `L47 forbidden file changed: ${file}`);
    assert(!file.startsWith('prisma/migrations/'), `L47 must not add migrations: ${file}`);
    assert(!file.startsWith('reports/'), `L47 business branch must not contain reports: ${file}`);
    assert(!file.startsWith('.tmp/'), `L47 business branch must not contain .tmp artifacts: ${file}`);
    assert(isL47AllowedChangedPath(file), `L47 changed file is outside the approved scope: ${file}`);
  }
}

verifyContract();
verifyBackend();
verifyMiniapp();
verifyChangedFiles();

console.log('L47 miniapp profile and leader center verification passed.');
