import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pageThemeManifest from './miniapp-theme/page-theme-manifest.cjs';

const root = resolve(process.cwd());
const failures: string[] = [];
const read = (relativePath: string): string => readFileSync(resolve(root, relativePath), 'utf8');
const fail = (message: string): void => { failures.push(message); };
const required = (relativePath: string): boolean => {
  const present = existsSync(resolve(root, relativePath));
  if (!present) fail('missing required theme file: ' + relativePath);
  return present;
};

const app = JSON.parse(read('apps/miniapp/app.json')) as { pages: string[] };
const pendingRoutes = new Set<string>(pageThemeManifest.pendingRoutes || []);
if (pendingRoutes.size > 0) fail('completed global theme must not retain migration exceptions');
if (app.pages.length !== 19 || new Set(app.pages).size !== 19) {
  fail('app.json must register exactly 19 unique pages; received ' + app.pages.length);
}

const visualLiteral = /#[0-9a-f]{3,8}\b|rgba?\s*\(|hsla?\s*\(/i;

for (const file of [
  'apps/miniapp/themes/chunhuaqiushi/theme.json',
  'apps/miniapp/themes/chunhuaqiushi/theme.js',
  'apps/miniapp/themes/active.generated.js',
  'apps/miniapp/styles/theme-active.generated.wxss',
  'apps/miniapp/components/ui/state-panel/index.wxml',
  'apps/miniapp/components/ui/media-thumb/index.wxml',
  'apps/miniapp/components/ui/status-pill/index.wxml',
]) required(file);

for (const component of ['state-panel', 'media-thumb', 'status-pill']) {
  const base = 'apps/miniapp/components/ui/' + component + '/index';
  for (const extension of ['js', 'json', 'wxml', 'wxss']) required(base + '.' + extension);
  if (existsSync(resolve(root, base + '.wxss')) && visualLiteral.test(read(base + '.wxss'))) {
    fail(base + '.wxss contains a hard-coded visual literal');
  }
}

for (const route of app.pages) {
  const wxmlPath = 'apps/miniapp/' + route + '.wxml';
  const wxssPath = 'apps/miniapp/' + route + '.wxss';
  if (!required(wxmlPath) || !required(wxssPath)) continue;
  const wxml = read(wxmlPath);
  const wxss = read(wxssPath);
  if (pendingRoutes.has(route)) continue;
  if (!/class=["'][^"']*\bcq-page\b/.test(wxml)) fail(route + ' root must include cq-page');
  if (visualLiteral.test(wxss)) fail(route + '.wxss contains a hard-coded visual literal');
}

if (failures.length) {
  console.error(failures.map((item) => '- ' + item).join('\n'));
  process.exit(1);
}

console.log('Mini Program global theme verification passed: ' + app.pages.length + '/19 pages.');
