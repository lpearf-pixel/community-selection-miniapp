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
  ['parent', '_leader_id'],
  ['up', 'line_id'],
  ['te', 'am_id'],
  ['二级', '返佣'],
  ['三级', '返佣'],
  ['下级', '收益'],
  ['团队', '收益'],
  ['返', '利'],
  ['分', '销'],
  ['代理', '收益'],
  ['_auth', 'Token'],
  ['npm_', '[A-Za-z0-9]'],
  ['/', 'root/'],
  ['/', 'Users/'],
  ['C:', String.raw`\\`]
].map((parts) => new RegExp(parts.join('')));

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
    const text = readFileSync(fullPath, 'utf8');
    for (const pattern of forbiddenTerms) {
      if (pattern.test(text)) {
        matches.push(`${relative(root, fullPath)} matches ${pattern}`);
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
