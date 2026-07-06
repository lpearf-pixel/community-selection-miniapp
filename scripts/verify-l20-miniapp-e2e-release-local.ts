import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scanComplianceFiles } from './lib/compliance-scan.js';

const repoRoot = process.cwd();
const requiredFiles = [
  'apps/miniapp/utils/api.js',
  'apps/miniapp/utils/user.js',
  'apps/miniapp/app.js',
  'apps/miniapp/app.json',
  'apps/miniapp/pages/products/index.js',
  'apps/miniapp/pages/products/index.wxml',
  'apps/miniapp/pages/product-detail/index.js',
  'apps/miniapp/pages/product-detail/index.wxml',
  'apps/miniapp/pages/orders/confirm/index.js',
  'apps/miniapp/pages/orders/detail/index.js',
  'apps/miniapp/pages/orders/detail/index.wxml',
  'apps/miniapp/pages/pickup/code/index.js',
  'apps/miniapp/pages/pickup/code/index.wxml',
  'apps/miniapp/pages/after-sales/apply/index.js',
  'apps/miniapp/pages/after-sales/apply/index.wxml',
  'apps/miniapp/pages/after-sales/detail/index.js',
  'apps/miniapp/pages/after-sales/detail/index.wxml'
];
const requiredPages = [
  'pages/products/index',
  'pages/product-detail/index',
  'pages/orders/confirm/index',
  'pages/orders/detail/index',
  'pages/pickup/code/index',
  'pages/after-sales/apply/index',
  'pages/after-sales/detail/index'
];
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function read(path: string) { return readFileSync(join(repoRoot, path), 'utf8'); }
for (const file of requiredFiles) assert(existsSync(join(repoRoot, file)), `${file} should exist`);
const appJson = JSON.parse(read('apps/miniapp/app.json')) as { pages: string[] };
for (const page of requiredPages) assert(appJson.pages.includes(page), `${page} should be registered`);
const allMiniappText = requiredFiles.filter((file) => /\.(js|wxml|json)$/.test(file)).map(read).join('\n');
assert(allMiniappText.includes('/api/products'), 'miniapp should load product list/detail APIs');
assert(allMiniappText.includes('/api/orders/normal'), 'miniapp should create normal purchase orders');
assert(allMiniappText.includes('/api/orders'), 'miniapp should create group buy orders');
assert(allMiniappText.includes('/api/payments/mock'), 'miniapp should use mock payment only');
assert(allMiniappText.includes('/api/me/orders/'), 'miniapp should connect order center detail APIs');
assert(allMiniappText.includes('/pickup-code'), 'miniapp should connect pickup code API');
assert(allMiniappText.includes('/after-sales'), 'miniapp should connect after-sales APIs');
assert(!allMiniappText.includes('wx.requestPayment'), 'L20 must not call wx.requestPayment');
assert(!allMiniappText.includes('/api/payments/wechat'), 'L20 must not connect real WeChat payment');
scanComplianceFiles([...requiredFiles, 'scripts/verify-l20-miniapp-e2e-release-local.ts', 'docs/reviews/l20-miniapp-e2e-release.md']);
console.log('Compliance scan passed.');
console.log('L20 miniapp e2e release verification passed.');
