const fs = require('node:fs');
const path = require('node:path');
const { launchDevTools } = require('./devtools-launcher.cjs');
const { buildThemeRoutes } = require('./theme-routes.cjs');
const {
  assertMiniappProjectConfigured,
  assertPagePath,
  overrideMiniappApiBaseUrl,
  resolveMiniappApiBaseUrl,
  resolveE2eConfig,
  restoreMiniappApiBaseUrl,
} = require('./lib.cjs');

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch (error) {
    return JSON.stringify({ serializationError: error.message });
  }
}

function themeArtifactPaths(baseDir = '/tmp', now = new Date()) {
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  const root = path.join(baseDir, 'chunhuaqiushi-miniapp-theme-' + timestamp);
  return {
    root,
    log: path.join(root, 'automation.log'),
    results: path.join(root, 'route-results.json'),
    devToolsLog: path.join(root, 'devtools.log'),
  };
}

async function waitForRoot(page, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const root = await page.$('.cq-page');
    if (root) return root;
    await delay(250);
  }
  throw new Error('Visible cq-page root did not appear before timeout');
}

async function waitForPageSettled(page, timeout = 7000) {
  const deadline = Date.now() + timeout;
  let data = {};
  while (Date.now() < deadline) {
    data = await page.data();
    const loading = Object.entries(data || {}).some(([key, value]) => /loading$/i.test(key) && value === true);
    if (!loading) return data;
    await delay(250);
  }
  return data;
}

async function discoverFixtures(miniProgram) {
  const fixtures = {
    productId: process.env.MINIAPP_E2E_PRODUCT_ID || '',
    groupBuyId: process.env.MINIAPP_E2E_GROUP_BUY_ID || '',
    orderId: process.env.MINIAPP_E2E_ORDER_ID || '',
  };
  let page = await miniProgram.reLaunch('/pages/index/index');
  await waitForRoot(page);
  const home = await waitForPageSettled(page);
  fixtures.productId = fixtures.productId || (home.products && home.products[0] && home.products[0].id) || '';
  fixtures.groupBuyId = fixtures.groupBuyId || (home.groupBuys && home.groupBuys[0] && home.groupBuys[0].id) || '';

  page = await miniProgram.reLaunch('/pages/orders/index');
  await waitForRoot(page);
  const orders = await waitForPageSettled(page);
  fixtures.orderId = fixtures.orderId || (orders.orders && orders.orders[0] && orders.orders[0].id) || '';
  return fixtures;
}

async function setRole(miniProgram, role) {
  const openid = role === 'leader'
    ? (process.env.MINIAPP_E2E_LEADER_OPENID || 'leader-openid')
    : (process.env.MINIAPP_E2E_CUSTOMER_OPENID || 'customer-openid');
  await miniProgram.callWxMethod('setStorageSync', 'community_selection_user', {
    user_id: '',
    openid,
    nickname: role === 'leader' ? '测试团长' : '测试用户',
  });
}

async function main() {
  const config = resolveE2eConfig();
  const apiBaseUrl = resolveMiniappApiBaseUrl();
  const artifacts = themeArtifactPaths(process.env.MINIAPP_E2E_OUTPUT_DIR || '/tmp');
  const logs = [];
  const exceptions = [];
  const results = [];
  let miniProgram;
  let previousApiBaseUrl;
  let apiBaseOverrideApplied = false;
  fs.mkdirSync(artifacts.root, { recursive: true });
  const record = (event, details = {}) => logs.push(new Date().toISOString() + ' ' + event + ' ' + safeJson(details));

  try {
    if (!fs.existsSync(config.cliPath)) throw new Error('WeChat DevTools CLI not found: ' + config.cliPath);
    if (!fs.existsSync(config.projectPath)) throw new Error('Mini Program project not found: ' + config.projectPath);
    const project = assertMiniappProjectConfigured(config.projectPath);
    record('project-identity', { appid: project.appid });
    const launched = await launchDevTools(config);
    miniProgram = launched.miniProgram;
    if (launched.cliOutput) fs.writeFileSync(artifacts.devToolsLog, launched.cliOutput, 'utf8');
    miniProgram.on('console', (event) => record('console', event));
    miniProgram.on('exception', (event) => {
      exceptions.push({ at: Date.now(), event });
      record('exception', event);
    });
    previousApiBaseUrl = await overrideMiniappApiBaseUrl(miniProgram, apiBaseUrl);
    apiBaseOverrideApplied = true;
    await setRole(miniProgram, 'customer');
    const fixtures = await discoverFixtures(miniProgram);
    record('fixtures', fixtures);

    for (const route of buildThemeRoutes(fixtures)) {
      await setRole(miniProgram, route.role);
      const exceptionCount = exceptions.length;
      const page = await miniProgram.reLaunch('/' + route.path + route.query);
      assertPagePath(page && page.path, route.path);
      await waitForRoot(page);
      const data = await waitForPageSettled(page);
      await delay(150);
      if (exceptions.length > exceptionCount) {
        throw new Error(route.path + ' emitted ' + (exceptions.length - exceptionCount) + ' MiniProgramError exception(s)');
      }
      const screenshotPath = path.join(artifacts.root, route.screenshot);
      await miniProgram.screenshot({ path: screenshotPath });
      if (!fs.existsSync(screenshotPath) || fs.statSync(screenshotPath).size === 0) {
        throw new Error(route.path + ' did not produce a screenshot');
      }
      const result = {
        path: route.path,
        query: route.query,
        role: route.role,
        screenshot: route.screenshot,
        dataKeys: Object.keys(data || {}).sort(),
        passed: true,
      };
      results.push(result);
      record('route-passed', result);
    }
    if (results.length !== 19) throw new Error('Expected 19 route results, received ' + results.length);
    record('passed', { routes: results.length });
  } catch (error) {
    record('failed', { message: error.message, stack: error.stack });
    process.exitCode = 1;
  } finally {
    if (miniProgram) {
      if (apiBaseOverrideApplied) {
        try {
          await restoreMiniappApiBaseUrl(miniProgram, previousApiBaseUrl);
          record('api-base-restored');
        } catch (error) {
          record('api-base-restore-error', { message: error.message });
          process.exitCode = 1;
        }
      }
      try {
        await miniProgram.close();
      } catch (error) {
        record('close-error', { message: error.message });
        process.exitCode = 1;
      }
    }
    fs.writeFileSync(artifacts.results, JSON.stringify({ routes: results, exceptions }, null, 2) + '\n');
    fs.writeFileSync(artifacts.log, logs.join('\n') + '\n', 'utf8');
    process.stdout.write('Mini Program theme smoke artifacts: ' + artifacts.root + '\n');
  }
}

main().catch((error) => {
  process.stderr.write((error.stack || error.message) + '\n');
  process.exitCode = 1;
});

module.exports = { discoverFixtures, setRole, themeArtifactPaths, waitForPageSettled, waitForRoot };
