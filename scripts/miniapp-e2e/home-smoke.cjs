const fs = require('node:fs');
const path = require('node:path');
const automator = require('miniprogram-automator');
const {
  artifactPaths,
  assertPagePath,
  resolveE2eConfig,
} = require('./lib.cjs');

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch (error) {
    return JSON.stringify({ serializationError: error.message });
  }
}

function summarizePageData(data) {
  const summary = {};
  for (const [key, value] of Object.entries(data || {})) {
    summary[key] = Array.isArray(value)
      ? { type: 'array', length: value.length }
      : { type: value === null ? 'null' : typeof value };
  }
  return summary;
}

async function waitForPagePath(miniProgram, expected, timeout = 10000) {
  const deadline = Date.now() + timeout;
  let current;
  while (Date.now() < deadline) {
    current = await miniProgram.currentPage();
    try {
      assertPagePath(current && current.path, expected);
      return current;
    } catch (error) {
      await delay(250);
    }
  }
  assertPagePath(current && current.path, expected);
}

async function findByTestId(page, testId, timeout = 10000) {
  const selector = `[data-testid="${testId}"]`;
  const componentSelectors = [
    'brand-hero',
    'category-grid',
    'product-showcase',
    'group-buy-showcase',
    'quick-actions',
  ];
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const pageElement = await page.$(selector);
    if (pageElement) return pageElement;
    for (const componentSelector of componentSelectors) {
      const component = await page.$(componentSelector);
      const componentElement = component && await component.$(selector);
      if (componentElement) return componentElement;
    }
    await delay(250);
  }
  throw new Error(`Missing Mini Program element ${selector}`);
}

async function main() {
  const config = resolveE2eConfig();
  const artifacts = artifactPaths(process.env.MINIAPP_E2E_OUTPUT_DIR || '/tmp');
  const logs = [];
  const exceptions = [];
  let miniProgram;

  fs.mkdirSync(path.dirname(artifacts.log), { recursive: true });
  const record = (event, details = {}) => {
    logs.push(`${new Date().toISOString()} ${event} ${safeJson(details)}`);
  };

  try {
    if (!fs.existsSync(config.cliPath)) throw new Error(`WeChat DevTools CLI not found: ${config.cliPath}`);
    if (!fs.existsSync(config.projectPath)) throw new Error(`Mini Program project not found: ${config.projectPath}`);

    record('launch', config);
    miniProgram = await automator.launch({
      cliPath: config.cliPath,
      projectPath: config.projectPath,
      port: config.port,
      trustProject: true,
    });
    miniProgram.on('console', (event) => record('console', event));
    miniProgram.on('exception', (event) => {
      exceptions.push(event);
      record('exception', event);
    });

    let page = await miniProgram.reLaunch('/pages/index/index');
    assertPagePath(page && page.path, 'pages/index/index');
    await findByTestId(page, 'home-brand');
    record('home-ready', { path: page.path });

    const routes = [
      ['home-products-entry', 'pages/products/index'],
      ['home-group-buys-entry', 'pages/group-buys/index'],
      ['home-orders-entry', 'pages/orders/index'],
    ];
    for (let index = 0; index < routes.length; index += 1) {
      const [testId, expectedPath] = routes[index];
      page = await miniProgram.currentPage();
      const element = await findByTestId(page, testId);
      await element.tap();
      page = await waitForPagePath(miniProgram, expectedPath);
      record('route-passed', { testId, path: page.path });
      if (index < routes.length - 1) {
        page = await miniProgram.navigateBack();
        assertPagePath(page && page.path, 'pages/index/index');
      }
    }

    if (exceptions.length) throw new Error(`Mini Program emitted ${exceptions.length} uncaught exception(s)`);
    record('passed');
  } catch (error) {
    record('failed', { message: error.message, stack: error.stack });
    if (miniProgram) {
      try {
        const page = await miniProgram.currentPage();
        record('failure-page', {
          path: page && page.path,
          data: page ? summarizePageData(await page.data()) : {},
        });
        await miniProgram.screenshot({ path: artifacts.screenshot });
        record('failure-screenshot', { path: artifacts.screenshot });
      } catch (evidenceError) {
        record('failure-evidence-error', { message: evidenceError.message });
      }
    }
    process.exitCode = 1;
  } finally {
    if (miniProgram) {
      try {
        await miniProgram.close();
      } catch (closeError) {
        record('close-error', { message: closeError.message });
        process.exitCode = 1;
      }
    }
    fs.writeFileSync(artifacts.log, `${logs.join('\n')}\n`, 'utf8');
    process.stdout.write(`Mini Program home smoke log: ${artifacts.log}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
