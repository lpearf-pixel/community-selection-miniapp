import { existsSync, readFileSync, statSync } from 'node:fs';

const failures: string[] = [];

function fail(message: string) {
  failures.push(message);
}

function read(path: string) {
  if (!existsSync(path)) {
    fail(`${path} is required`);
    return '';
  }
  return readFileSync(path, 'utf8');
}

function count(source: string, needle: string) {
  return source.split(needle).length - 1;
}

const requiredFiles = [
  'apps/miniapp/pages/index/home-model.js',
  'apps/miniapp/pages/index/templates/index.js',
  'apps/miniapp/pages/index/templates/chunhuaqiushi.js',
  'apps/miniapp/themes/chunhuaqiushi/theme.json',
  'apps/miniapp/themes/chunhuaqiushi/theme.js',
  'apps/miniapp/themes/active.generated.js',
  'apps/miniapp/components/home/brand-hero/index.wxml',
  'apps/miniapp/components/home/category-grid/index.wxml',
  'apps/miniapp/components/home/product-showcase/index.wxml',
  'apps/miniapp/components/home/group-buy-showcase/index.wxml',
  'apps/miniapp/components/home/quick-actions/index.wxml',
  'apps/miniapp/styles/tokens.wxss',
  'apps/miniapp/styles/themes/chunhuaqiushi.wxss',
  'apps/miniapp/assets/brand/chunhuaqiushi-logo.jpg',
  'apps/miniapp/assets/brand/chunhuaqiushi-hero.jpg',
  'apps/miniapp/assets/catalog/chunhuaqiushi-catalog-sprite.jpg',
  'scripts/miniapp-e2e/home-smoke.cjs',
  'scripts/miniapp-e2e/lib.cjs',
  'scripts/miniapp-e2e/setup-miniapp-project.cjs',
  'scripts/miniapp-e2e/container-runner.cjs',
  'scripts/miniapp-e2e/container-cleanup.cjs',
  'scripts/miniapp-e2e/package.json',
  'scripts/miniapp-e2e/pnpm-lock.yaml',
  'apps/miniapp/project.config.example.json',
];

for (const path of requiredFiles) {
  if (!existsSync(path)) fail(`${path} is required`);
}

const config = read('apps/miniapp/config.js');
const templateRegistry = read('apps/miniapp/pages/index/templates/index.js');
const templateCompatibilityEntry = read('apps/miniapp/pages/index/templates/chunhuaqiushi.js');
const templateDescriptor = read('apps/miniapp/themes/chunhuaqiushi/theme.json');
const template = read('apps/miniapp/themes/chunhuaqiushi/theme.js');
const pageJs = read('apps/miniapp/pages/index/index.js');
const pageWxml = read('apps/miniapp/pages/index/index.wxml');
const pageJson = read('apps/miniapp/pages/index/index.json');
const appJson = read('apps/miniapp/app.json');
const packageJson = read('package.json');
const e2ePackageJson = read('scripts/miniapp-e2e/package.json');
const e2eLib = read('scripts/miniapp-e2e/lib.cjs');
const devToolsLauncher = read('scripts/miniapp-e2e/devtools-launcher.cjs');
const homeSmoke = read('scripts/miniapp-e2e/home-smoke.cjs');
const containerRunner = read('scripts/miniapp-e2e/container-runner.cjs');
const containerCleanup = read('scripts/miniapp-e2e/container-cleanup.cjs');
const projectSetup = read('scripts/miniapp-e2e/setup-miniapp-project.cjs');
const gitignore = read('.gitignore');
const compose = read('docker-compose.yml');

if (!config.includes("require('./themes/active.generated')") || !/homeTemplateKey\s*:\s*activeTheme\.id/.test(config)) {
  fail('config must select the globally active home template');
}
if (!/DEFAULT_HOME_TEMPLATE_KEY\s*=\s*activeTheme\.id/.test(templateRegistry)) fail('template registry must define the active default key');
if (!templateRegistry.includes('registry[key] || activeTheme')) fail('template registry must fail safe to the active template');
if (!templateCompatibilityEntry.includes("require('../../../themes/chunhuaqiushi/theme')")) {
  fail('legacy template entry must re-export the global theme descriptor');
}

for (const text of ['春华秋实', '社区甄选', '健康源于自然，温暖来自邻里']) {
  if (!(template + templateDescriptor).includes(text)) fail(`template must contain ${text}`);
}
for (const type of ['brandHero', 'categoryGrid', 'productShowcase', 'groupBuyShowcase', 'quickActions']) {
  if (!template.includes(`type: '${type}'`)) fail(`template must register ${type}`);
  if (!pageWxml.includes(`section.type === '${type}'`)) fail(`page shell must render ${type}`);
}
if (/(?:https?:\/\/|\/api\/|\bwx\.)/.test(template + templateDescriptor)) fail('theme configuration must not contain URLs, API paths, or wx APIs');

for (const endpoint of ['/api/products', '/api/group-buys']) {
  if (!pageJs.includes(`url: '${endpoint}'`) && !pageJs.includes(`url: \"${endpoint}\"`)) fail(`home page must request ${endpoint}`);
}
if (!/require\(['"]\.\.\/\.\.\/utils\/api['"]\)/.test(pageJs) || !pageJs.includes('request')) fail('home page must use the shared request helper');
if (!/require\(['"]\.\/templates\/index['"]\)/.test(pageJs)) fail('home page must explicitly require the template registry file for WeChat module resolution');
if (/\/\s*100/.test(pageWxml)) fail('home WXML must not calculate cents');
for (const needle of ['wx.login', 'wx.requestPayment', 'wx.getLocation', 'cost_price_cents', 'commission_value', 'stock_deduct_quantity']) {
  if ((pageJs + pageWxml + template).includes(needle)) fail(`home source must not include ${needle}`);
}

const componentAliases = ['brand-hero', 'category-grid', 'product-showcase', 'group-buy-showcase', 'quick-actions'];
for (const alias of componentAliases) {
  if (count(pageJson, `\"${alias}\"`) !== 1) fail(`index.json must register ${alias} exactly once`);
}

const componentWxml = [
  pageWxml,
  ...componentAliases.map((alias) => read(`apps/miniapp/components/home/${alias}/index.wxml`)),
].join('\n');

for (const key of ['heroImagePath', 'catalogSpritePath', 'spriteOffset']) {
  if (!template.includes(key)) fail(`home template must define ${key}`);
}
for (const selector of ['brand-hero-image', 'category-sprite-image', 'product-sprite-image', 'group-sprite-image']) {
  if (!componentWxml.includes(selector)) fail(`home visual components must render ${selector}`);
}
for (const asset of [
  'apps/miniapp/assets/brand/chunhuaqiushi-hero.jpg',
  'apps/miniapp/assets/catalog/chunhuaqiushi-catalog-sprite.jpg',
]) {
  if (existsSync(asset) && readFileSync(asset).subarray(0, 3).toString('hex') !== 'ffd8ff') fail(`${asset} must be a JPEG`);
}
const visualAssetBytes = [
  'apps/miniapp/assets/brand/chunhuaqiushi-hero.jpg',
  'apps/miniapp/assets/catalog/chunhuaqiushi-catalog-sprite.jpg',
].reduce((total, asset) => total + (existsSync(asset) ? statSync(asset).size : 0), 0);
if (visualAssetBytes > 512000) fail('home hero and catalog sprite must stay below 500 KiB combined');
for (const testId of ['home-brand', 'home-products-entry', 'home-group-buys-entry', 'home-orders-entry', 'home-products-retry', 'home-group-buys-retry']) {
  if (count(componentWxml, `data-testid=\"${testId}\"`) !== 1) fail(`${testId} must exist exactly once`);
}
for (const dynamicId of ['home-category-{{item.key}}', 'home-product-{{item.id}}', 'home-group-buy-{{item.id}}']) {
  if (count(componentWxml, `data-testid=\"${dynamicId}\"`) !== 1) fail(`${dynamicId} must exist exactly once`);
}

if (!appJson.includes('"navigationBarTitleText": "春华秋实"')) fail('app navigation title must use the brand name');
if (!pageJson.includes('"navigationBarTitleText": "春华秋实"')) fail('home navigation title must use the brand name');
if (!packageJson.includes('"e2e:miniapp:home"')) fail('package scripts must expose the Mac home smoke test');
if (!packageJson.includes('"setup:miniapp:e2e"')) fail('package scripts must expose isolated E2E dependency setup');
if (!packageJson.includes('"setup:miniapp:project": "node scripts/miniapp-e2e/setup-miniapp-project.cjs"')) fail('package scripts must expose local Mini Program identity setup');
if (!packageJson.includes('"e2e:miniapp:home": "node scripts/miniapp-e2e/container-runner.cjs"')) fail('main home E2E command must orchestrate container services');
if (!packageJson.includes('"e2e:miniapp:home:click-only": "node scripts/miniapp-e2e/home-smoke.cjs"')) fail('package scripts must expose click-only reruns');
if (!packageJson.includes('"e2e:miniapp:stop": "node scripts/miniapp-e2e/container-cleanup.cjs"')) fail('package scripts must expose service-scoped container cleanup');
if (!/"miniprogram-automator"\s*:\s*"0\.12\.1"/.test(e2ePackageJson)) fail('E2E package must pin miniprogram-automator 0.12.1');
for (const service of ['postgres', 'api']) {
  if (!containerRunner.includes(`'${service}'`) && !containerRunner.includes('config.services')) fail(`container runner must start ${service}`);
  if (!compose.includes(`  ${service}:`)) fail(`docker-compose.yml must define ${service}`);
}
if (!containerRunner.includes('composeUpArgs(config)')) fail('container runner must use the verified Compose up contract');
if (!containerRunner.includes('assertSupportedPlatform();')) fail('container runner must reject non-Mac hosts before starting Docker services');
if (!e2eLib.includes("'ps', '--all'")) fail('Compose diagnostics must include stopped and exited service containers');
if (!containerRunner.includes('waitForHealth(config)')) fail('container runner must verify the host API health endpoint');
if (!containerRunner.includes('writeComposeDiagnostics')) fail('container runner must collect Compose diagnostics on failure');
if (!containerRunner.includes('MINIAPP_E2E_API_BASE_URL')) fail('container runner must pass the container API origin to the click smoke');
for (const helper of ['overrideMiniappApiBaseUrl', 'restoreMiniappApiBaseUrl', 'waitForHomeApi']) {
  if (!homeSmoke.includes(helper)) fail(`home click smoke must use ${helper}`);
}
if (!homeSmoke.includes("require('./devtools-launcher.cjs')") || !homeSmoke.includes('launchDevTools(config)')) {
  fail('home click smoke must use the diagnostic DevTools launcher');
}
if (homeSmoke.includes('automator.launch')) fail('home click smoke must not use the log-suppressing default launcher');
for (const needle of ['buildDevToolsAutoArgs', 'diagnoseDevToolsLaunch', 'isPortOpen']) {
  if (!devToolsLauncher.includes(needle)) fail(`DevTools launcher must use ${needle}`);
}
if (!homeSmoke.includes('artifacts.devToolsLog')) fail('home click smoke must persist DevTools CLI diagnostics');
for (const source of [homeSmoke, containerRunner]) {
  if (!source.includes('assertMiniappProjectConfigured')) fail('Mini Program runners must reject tourist projects before external startup');
}
if (!projectSetup.includes('MINIAPP_APP_ID')) fail('Mini Program project setup must read MINIAPP_APP_ID');
if (!/^apps\/miniapp\/project\.config\.json$/m.test(gitignore)) fail('local project.config.json must be ignored');
if (!containerCleanup.includes('composeStopArgs(config)')) fail('container cleanup must use the verified service-scoped stop contract');
if (/\bdown\b|(?:-v|--volumes)/.test(containerCleanup)) fail('container cleanup must not tear down the Compose project or named volumes');

if (failures.length) {
  throw new Error(`L49 brand home static verification failed:\n- ${[...new Set(failures)].join('\n- ')}`);
}

console.log('L49 brand home static verification passed.');
