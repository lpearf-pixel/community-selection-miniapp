import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const root = process.cwd();
const scanRoots = ['apps', 'packages', 'prisma', 'scripts'];
const ignoredDirs = new Set(['node_modules', 'dist', 'build', '.vite']);
const checkedExtensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.prisma', '.sql', '.wxml', '.wxss']);
const docWhitelist = [/^docs\//, /^AGENTS\.md$/, /^README\.md$/, /^CODEX_/];
const forbidden = [
  ['parent', '_leader_id'].join(''),
  ['up', 'line_id'].join(''),
  ['te', 'am_id'].join(''),
  ['down', 'line'].join(''),
  ['二级', '返佣'].join(''),
  ['三级', '返佣'].join(''),
  ['分', '销'].join(''),
  ['返', '利'].join(''),
  ['下级', '收益'].join(''),
  ['团队', '收益'].join(''),
  ['代理', '收益'].join(''),
  ['躺', '赚'].join(''),
  ['免', '税'].join(''),
  ['避', '税'].join(''),
  ['不', '交税'].join('')
];

function isWhitelistedDoc(path: string) {
  return docWhitelist.some((pattern) => pattern.test(path));
}

function isAllowedLine(path: string, line: string, term: string) {
  if (isWhitelistedDoc(path) && /禁止|不允许|不得|不要|合规|边界/.test(line)) return true;
  if (term === ['le', 'vel'].join('') && line.includes(`Typography.Title ${['le', 'vel'].join('')}=`)) return true;
  return false;
}

function walk(dir: string, matches: string[]) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (!ignoredDirs.has(entry)) walk(fullPath, matches);
      continue;
    }
    if (!checkedExtensions.has(extname(entry))) continue;
    const path = relative(root, fullPath);
    const lines = readFileSync(fullPath, 'utf8').split('\n');
    lines.forEach((line, index) => {
      for (const term of forbidden) {
        if (line.includes(term) && !isAllowedLine(path, line, term)) matches.push(`${path}:${index + 1} contains ${term}`);
      }
      const levelTerm = ['le', 'vel'].join('');
      if (new RegExp(`\\b${levelTerm}\\b`).test(line) && !isAllowedLine(path, line, levelTerm)) matches.push(`${path}:${index + 1} contains ${levelTerm}`);
    });
  }
}

const matches: string[] = [];
for (const item of scanRoots) walk(join(root, item), matches);
if (matches.length > 0) {
  console.error('Compliance scan failed:');
  for (const match of matches) console.error(`- ${match}`);
  process.exit(1);
}
console.log('Compliance scan passed.');
