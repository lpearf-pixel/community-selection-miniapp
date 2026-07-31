import { readFileSync } from 'node:fs';
import { extractMarkdownFilePaths } from './report-markdown.ts';
import { normalizeL45ReportArtifact, normalizeL46ReportArtifact } from './report-artifact-normalizer.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const reportFixture = [
  '## 2. 本阶段变更范围',
  '',
  '| 类型 | 文件 | 说明 |',
  '|---|---|---|',
  '| 代码 | scripts/example.ts | nested file |',
  '| 配置 | package.json | repository-root file |',
  '| 配置 | docker-compose.yml | repository-root file |',
  '| 锁文件 | pnpm-lock.yaml | repository-root file |',
  '',
  '## 3. API 变化',
].join('\n');

const expected = ['docker-compose.yml', 'package.json', 'pnpm-lock.yaml', 'scripts/example.ts'];
const actual = extractMarkdownFilePaths(reportFixture);
assert(JSON.stringify(actual) === JSON.stringify(expected), `Report Markdown parser must retain nested and repository-root files. expected=${expected.join(',')} actual=${actual.join(',')}`);

const l45PushCommand = 'scripts/stage-workflow.ts --stage=L45 --publish --scope=chain --push';
const normalizedL45 = normalizeL45ReportArtifact(`## 5. 核心业务验收点\n\n- [x] ${l45PushCommand}（passed）`);
assert(!normalizedL45.includes(l45PushCommand), 'L45 report artifact must not claim that --push ran during a no-push rehearsal');
assert(normalizedL45.includes('scripts/stage-workflow.ts --stage=L45 --publish --scope=chain（passed）'), 'L45 report artifact must retain the canonical no-push workflow command');

const normalizedL46 = normalizeL46ReportArtifact([
  '## 3. API 变化',
  '',
  '| 方法 | 路径 | 权限 | 用途 | 是否有验收 |',
  '|---|---|---|---|---|',
  '| GET | /api/leaders/me/withdrawals | public | unknown | yes |',
  '',
  '## 4. 数据库变化',
  '',
  '无',
].join('\n'));
const l46ApiSection = normalizedL46.split('## 3. API 变化')[1]?.split('## 4. 数据库变化')[0] ?? '';
for (const path of ['/api/admin/dashboard-v2/overview', '/api/admin/dashboard-v2/trends', '/api/admin/dashboard-v2/alerts']) {
  assert(l46ApiSection.includes(path), `L46 report API section must contain ${path}`);
}
for (const forbidden of ['public', 'admin session', 'unknown', '/api/leaders/me/withdrawals']) {
  assert(!l46ApiSection.includes(forbidden), `L46 report API section must not contain ${forbidden}`);
}
assert(l46ApiSection.includes('operations.view/order.view/pickup.verify/after_sale.manage/product.manage'), 'L46 report API section must document Operations permissions');
assert(l46ApiSection.includes('finance.view/refund.view/reward.view/withdrawal.view + admin data scope'), 'L46 report API section must document Finance permissions and data scope');

const genericVerifier = readFileSync('scripts/verify-report-publish-local.ts', 'utf8');
const l46Verifier = readFileSync('scripts/verify-l46-report-publish-local.ts', 'utf8');
assert(genericVerifier.includes("from './report-markdown.ts'"), 'Historical report publish verifier must reuse the shared Markdown parser');
assert(l46Verifier.includes("from './report-markdown.ts'"), 'L46 report publish verifier must reuse the shared Markdown parser');

const reportEntry = readFileSync('scripts/generate-stage-report-entry.ts', 'utf8');
assert(reportEntry.includes("from './report-artifact-normalizer.ts'"), 'Canonical report entry must import final artifact normalization');
assert(reportEntry.includes('applyStageReportArtifactNormalization(stage)'), 'Canonical report entry must normalize the final Stage report');

const verifyAll = readFileSync('scripts/verify-all-local.sh', 'utf8');
const l46Case = verifyAll.match(/L46\|L47\)([\s\S]*?);;/)?.[1] ?? '';
assert(l46Case.includes('scripts/stage-workflow.ts') && l46Case.includes('--stage=${REPORT_PUBLISH_STAGE_NORMALIZED}') && l46Case.includes('--publish') && l46Case.includes('--scope=chain') && l46Case.includes('exit 2'), 'verify:all must fail closed and direct L46/L47 report publication to the commit-bound stage workflow');
assert(!l46Case.includes('scripts/verify-report-publish-local.ts'), 'verify:all must not route L46 through the historical report verifier');
assert(verifyAll.includes('scripts/verify-report-publish-local.ts'), 'verify:all must preserve historical report publish verification');

const complianceReleaseIndex = verifyAll.indexOf(
  'pnpm exec tsx scripts/verify-l53-d2-compliance-release-local.ts',
);
const seedCheckIndex = verifyAll.indexOf('pnpm seed:check');
const repositoryTypecheckIndex = verifyAll.indexOf('pnpm typecheck');
const mutatingHistoricalVerifierIndex = verifyAll.indexOf(
  'pnpm exec tsx scripts/run-registered-stage-verifiers.ts --from=L24 --to=L47',
);
assert(
  seedCheckIndex >= 0 &&
    complianceReleaseIndex >= 0 &&
    repositoryTypecheckIndex >= 0 &&
    mutatingHistoricalVerifierIndex >= 0,
  'verify:all must register the seed check, L53 release gate, repository checks and historical stage verifiers',
);
assert(
  seedCheckIndex < complianceReleaseIndex &&
    complianceReleaseIndex < repositoryTypecheckIndex &&
    complianceReleaseIndex < mutatingHistoricalVerifierIndex,
  'verify:all must evaluate the production seed immediately after seed validation and before repository or historical checks can mutate it',
);

console.log('Report Markdown, artifact normalization, and verify:all routing checks passed.');
