import { readFileSync } from 'node:fs';
import { extractMarkdownFilePaths } from './report-markdown.ts';

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

const genericVerifier = readFileSync('scripts/verify-report-publish-local.ts', 'utf8');
const l46Verifier = readFileSync('scripts/verify-l46-report-publish-local.ts', 'utf8');
assert(genericVerifier.includes("from './report-markdown.ts'"), 'Historical report publish verifier must reuse the shared Markdown parser');
assert(l46Verifier.includes("from './report-markdown.ts'"), 'L46 report publish verifier must reuse the shared Markdown parser');

const verifyAll = readFileSync('scripts/verify-all-local.sh', 'utf8');
assert(verifyAll.includes('scripts/verify-l46-report-publish-local.ts'), 'verify:all must route L46 to its strict report publish verifier');
assert(verifyAll.includes('scripts/verify-report-publish-local.ts'), 'verify:all must preserve historical report publish verification');

console.log('Report Markdown and verify:all routing checks passed.');
