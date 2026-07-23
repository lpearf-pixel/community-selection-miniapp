import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseURL = process.env.ADMIN_E2E_BASE_URL ?? 'http://127.0.0.1:13081';
const credentials = JSON.parse(await readFile(new URL('./.fixture.json', import.meta.url), 'utf8'));
const navigation = [
  '商品管理', '团购管理', '失败团购人工关闭', '订单管理', '履约看板',
  '库存管理', '采购计划', '供应商管理', '批次库存', '临期提醒',
  '库存盘点', '售后客服', '提现管理', '告警中心', '税务人工 Review',
  '经营驾驶舱 V2', '财务对账', '退款台账', '开团服务奖励', '运营看板',
  '自提工作台', '配送预留', '管理配送规则',
];

async function waitForCount(page, readCount, minimum, label) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (readCount() >= minimum) return;
    await page.waitForTimeout(100);
  }
  assert.fail(`${label}: expected at least ${minimum}, received ${readCount()}`);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

let financeRequestCount = 0;
let operationsRequestCount = 0;
let operationsFailureInjected = false;

page.on('request', (request) => {
  const pathname = new URL(request.url()).pathname;
  if (pathname.startsWith('/api/admin/finance/reconciliation/')) {
    financeRequestCount += 1;
  }
  if (pathname.startsWith('/api/admin/operations/dashboard/')) {
    operationsRequestCount += 1;
  }
});

try {
  await page.goto(baseURL, { waitUntil: 'networkidle' });
  await page.getByText('后台登录', { exact: true }).waitFor();
  await page.getByLabel('用户名').fill(credentials.username);
  await page.getByLabel('密码').fill(credentials.password);
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await page.getByRole('heading', { name: '社区甄选管理后台' }).waitFor();
  await page.getByText(`当前管理员：${credentials.username}`).waitFor();

  const shell = page.getByRole('heading', { name: '社区甄选管理后台' }).locator('..');
  const buttons = shell.getByRole('button');
  const assertActive = async (button, label) => {
    const className = await button.getAttribute('class');
    assert.match(className ?? '', /ant-btn-primary/, `${label} did not become active`);
  };

  const financeRequestsBeforeSelection = financeRequestCount;
  const operationsRequestsBeforeSelection = operationsRequestCount;
  assert.equal(financeRequestsBeforeSelection, 0);
  assert.equal(operationsRequestsBeforeSelection, 0);

  const financeButton = shell.getByRole('button', {
    name: '财务对账',
    exact: true,
  });
  await financeButton.click();
  await assertActive(financeButton, '财务对账');
  await page.getByText('订单对账表', { exact: true }).waitFor();
  await waitForCount(page, () => financeRequestCount, 4, 'finance initial load');
  assert.equal(operationsRequestCount, 0);

  await shell.getByRole('button', { name: /刷\s*新/ }).click();
  await waitForCount(page, () => financeRequestCount, 8, 'finance active refresh');
  assert.equal(operationsRequestCount, 0);
  assert.equal(await page.getByText('财务对账加载失败').count(), 0);

  const financeRequestsAfterRefresh = financeRequestCount;
  const operationsButton = shell.getByRole('button', {
    name: '运营看板',
    exact: true,
  });
  await operationsButton.click();
  await assertActive(operationsButton, '运营看板');
  await page.getByText('近 7 日趋势表', { exact: true }).waitFor();
  await waitForCount(page, () => operationsRequestCount, 6, 'operations initial load');

  const operationsRequestsAfterInitial = operationsRequestCount;
  await page.route('**/api/admin/operations/dashboard/overview', async (route) => {
    if (!operationsFailureInjected) {
      operationsFailureInjected = true;
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          code: 'E2E_OPERATIONS_FAILURE',
          message: '模拟运营看板失败',
        }),
      });
      return;
    }
    await route.continue();
  });

  await shell.getByRole('button', { name: /刷\s*新/ }).click();
  await page.getByText('运营看板加载失败', { exact: true }).waitFor();
  await page.getByRole('heading', { name: '社区甄选管理后台' }).waitFor();
  assert.equal(operationsFailureInjected, true);
  await waitForCount(
    page,
    () => operationsRequestCount,
    operationsRequestsAfterInitial + 6,
    'operations failed refresh',
  );

  const operationsRequestsAfterFailure = operationsRequestCount;
  await page.getByRole('button', { name: /重\s*试/ }).click();
  await page.getByText('运营看板加载失败').waitFor({ state: 'detached' });
  await page.getByText('近 7 日趋势表', { exact: true }).waitFor();
  await waitForCount(
    page,
    () => operationsRequestCount,
    operationsRequestsAfterFailure + 6,
    'operations retry',
  );
  assert.equal(financeRequestCount, financeRequestsAfterRefresh);

  const remainingNavigation = navigation.filter(
    (label) => label !== '财务对账' && label !== '运营看板',
  );
  for (const label of remainingNavigation) {
    const button = shell.getByRole('button', { name: label, exact: true });
    await button.click();
    await assertActive(button, label);
    await page.getByRole('heading', { name: '社区甄选管理后台' }).waitFor();
  }
  assert.equal(await buttons.filter({ hasText: /./ }).count() >= 25, true);

  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText(`当前管理员：${credentials.username}`).waitFor();
  await shell.getByRole('button', { name: '商品管理', exact: true }).waitFor();

  await page.evaluate(() => { window.__ADMIN_E2E_FORCE_RENDER_ERROR__ = true; });
  await shell.getByRole('button', { name: '订单管理', exact: true }).click();
  await page.getByText('当前页面加载失败').waitFor();
  await page.getByRole('heading', { name: '社区甄选管理后台' }).waitFor();
  await page.evaluate(() => { window.__ADMIN_E2E_FORCE_RENDER_ERROR__ = false; });
  await shell.getByRole('button', { name: '商品管理', exact: true }).click();
  await page.getByText('当前页面加载失败').waitFor({ state: 'detached' });

  await shell.getByRole('button', { name: /刷\s*新/ }).click();
  await shell.getByRole('button', { name: '退出登录', exact: true }).click();
  await page.getByText('后台登录', { exact: true }).waitFor();
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText('后台登录', { exact: true }).waitFor();

  console.log(
    `L50 Admin browser smoke passed: ${navigation.length}/${navigation.length} navigation items; finance requests=${financeRequestCount}; operations requests=${operationsRequestCount}.`,
  );
} finally {
  await context.close();
  await browser.close();
}
