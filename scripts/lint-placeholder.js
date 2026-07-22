#!/usr/bin/env node
const { readdirSync, readFileSync, statSync } = require('node:fs');
const { join, relative } = require('node:path');

const root = process.cwd();
const ignoredDirs = new Set(['.git', 'node_modules', 'dist', 'build', '.vite', 'docs']);
const ignoredFiles = new Set(['AGENTS.md', 'CODEX_TASK.md', 'CODEX_STAGES.md', 'README.md']);
const checkedExtensions = new Set([
  '.js', '.cjs', '.mjs', '.ts', '.tsx', '.json', '.prisma', '.yml', '.yaml', '.wxss', '.wxml'
]);
const forbiddenTerms = [
  ['parent-leader-id', ['parent', '_leader_id']],
  ['upline-id', ['up', 'line_id']],
  ['team-id', ['te', 'am_id']],
  ['level-two-commission', ['二级', '返佣']],
  ['level-three-commission', ['三级', '返佣']],
  ['downline-income', ['下级', '收益']],
  ['team-income', ['团队', '收益']],
  ['legacy-reward-copy', ['返', '利']],
  ['distribution-copy', ['分', '销']],
  ['agent-income', ['代理', '收益']],
  ['auth-token', ['_auth', 'Token']],
  ['npm-token', ['npm_', '[A-Za-z0-9]']],
  ['container-root-path', ['/', 'root/']],
  ['mac-user-path', ['/', 'Users/']],
  ['windows-drive-path', ['C:', String.raw`\\`]]
].map(([id, parts]) => ({ id, pattern: new RegExp(parts.join('')) }));

// These files intentionally contain a forbidden term as verification data or a
// container-internal cache path. Exempt only that exact file/rule pair so the
// same term remains forbidden everywhere else, including other test scripts.
const allowedMatchesByFile = new Map([
  ['docker-compose.yml', new Set(['container-root-path'])],
  ['scripts/generate-stage-report.ts', new Set(['legacy-reward-copy'])],
  ['scripts/miniapp-e2e/home-smoke.test.cjs', new Set(['mac-user-path'])],
  ['scripts/verify-docker-compose-local.ts', new Set(['container-root-path'])],
  ['scripts/verify-l26-group-buy-success-rule-local.ts', new Set(['legacy-reward-copy', 'distribution-copy'])],
  ['scripts/verify-l27-group-buy-expiry-manual-refund-local.ts', new Set(['legacy-reward-copy', 'distribution-copy'])],
  ['scripts/verify-l34-admin-data-scope-baseline-local.ts', new Set(['legacy-reward-copy', 'distribution-copy'])],
  ['scripts/verify-no-raw-compliance-terms-local.ts', new Set(['legacy-reward-copy', 'distribution-copy'])],
]);

function extensionOf(filePath) {
  const dotIndex = filePath.lastIndexOf('.');
  return dotIndex === -1 ? '' : filePath.slice(dotIndex);
}

function walk(dir, matches) {
  for (const entry of readdirSync(dir)) {
    if (ignoredDirs.has(entry)) continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      walk(fullPath, matches);
      continue;
    }
    if (ignoredFiles.has(entry)) continue;
    if (!checkedExtensions.has(extensionOf(entry)) && entry !== '.npmrc') continue;
    const pathFromRoot = relative(root, fullPath).replaceAll('\\', '/');
    const allowedRuleIds = allowedMatchesByFile.get(pathFromRoot);
    const text = readFileSync(fullPath, 'utf8');
    for (const { id, pattern } of forbiddenTerms) {
      if (pattern.test(text)) {
        if (allowedRuleIds?.has(id)) continue;
        matches.push(`${pathFromRoot} matches ${pattern}`);
      }
    }
  }
}

const matches = [];
walk(root, matches);

if (matches.length > 0) {
  console.error('L1 lightweight lint failed:');
  for (const match of matches) console.error(`- ${match}`);
  process.exit(1);
}

console.log('L1 lightweight lint passed.');
