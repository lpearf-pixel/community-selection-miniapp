import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const excludedDirs = new Set(['node_modules', 'reports', '.git', '.tmp']);
const forbiddenTerms = [
  '优' + '惠券',
  '裂' + '变',
  '会' + '员',
  '多级' + '分销',
  '团队' + '收益',
  '代理' + '收益',
  '下' + '线',
  '上' + '级',
  '下' + '级',
  '邀请' + '返利',
  '拉人' + '赚钱',
  'AUTO_PAYOUT_ENABLED = ' + 'true',
  'AUTO_TAX_FILING_ENABLED = ' + 'true'
];

function walk(dir: string, predicate: (file: string) => boolean, result: string[] = []) {
  if (!existsSync(dir)) return result;
  for (const entry of readdirSync(dir)) {
    if (excludedDirs.has(entry)) continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) walk(fullPath, predicate, result);
    else if (predicate(fullPath)) result.push(fullPath);
  }
  return result;
}

const files = [
  ...walk(join(repoRoot, 'scripts'), (file) => /\/verify-[^/]+\.ts$/.test(file) && !file.endsWith('/lib/compliance-scan.ts')),
  ...walk(join(repoRoot, 'docs', 'reviews'), (file) => file.endsWith('.md')),
  join(repoRoot, 'scripts', 'generate-stage-report.ts')
].filter((file, index, all) => all.indexOf(file) === index && existsSync(file));

const violations: Array<{ file: string; term: string }> = [];
for (const file of files) {
  const content = readFileSync(file, 'utf8');
  for (const term of forbiddenTerms) {
    if (content.includes(term)) violations.push({ file, term });
  }
}

if (violations.length > 0) {
  for (const violation of violations) {
    console.error(`${violation.file.replace(`${repoRoot}/`, '')}: raw compliance-sensitive term found: ${violation.term}`);
  }
  process.exit(1);
}

console.log('No raw compliance-sensitive terms found in verify/docs files.');
