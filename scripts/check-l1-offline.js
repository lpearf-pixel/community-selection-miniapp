#!/usr/bin/env node
const { existsSync, readdirSync, readFileSync, statSync } = require('node:fs');
const { join, relative } = require('node:path');

const root = process.cwd();
const scanRoots = ['.npmrc', 'package.json', 'pnpm-workspace.yaml', 'apps', 'packages', 'prisma'];
const ignoredDirs = new Set(['node_modules', 'dist', 'build', '.vite']);
const checkedExtensions = new Set(['.js', '.cjs', '.mjs', '.ts', '.tsx', '.json', '.prisma', '.yml', '.yaml', '.wxss', '.wxml']);
const dbScriptPattern = /"db:(migrate|seed|studio)"|seed\.ts/;
const tokenOrLocalPathPatterns = [
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

function shouldScanFile(filePath) {
  const base = filePath.split('/').pop();
  return base === '.npmrc' || checkedExtensions.has(extensionOf(filePath));
}

function checkFile(filePath, failures) {
  if (!shouldScanFile(filePath)) return;
  const text = readFileSync(filePath, 'utf8');
  const rel = relative(root, filePath);
  if (dbScriptPattern.test(text)) {
    failures.push(`${rel}: L2 database script or seed placeholder found`);
  }
  for (const pattern of tokenOrLocalPathPatterns) {
    if (pattern.test(text)) {
      failures.push(`${rel}: token or local absolute path pattern found`);
    }
  }
}

function walk(filePath, failures) {
  if (!existsSync(filePath)) return;
  const stat = statSync(filePath);
  if (stat.isDirectory()) {
    const name = filePath.split('/').pop();
    if (ignoredDirs.has(name)) return;
    for (const entry of readdirSync(filePath)) {
      walk(join(filePath, entry), failures);
    }
    return;
  }
  checkFile(filePath, failures);
}

const failures = [];
for (const item of scanRoots) {
  walk(join(root, item), failures);
}

if (failures.length > 0) {
  console.error('L1 offline checks failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('L1 offline checks passed.');
