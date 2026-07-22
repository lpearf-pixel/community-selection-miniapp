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

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

try {
  await page.goto(baseURL, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: '后台登录' }).waitFor();
  await page.getByLabel('用户名').fill(credentials.username);
  await page.getByLabel('密码').fill(credentials.password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('heading', { name: '社区甄选管理后台' }).waitFor();
  await page.getByText(`当前管理员：${credentials.username}`).waitFor();

  const buttons = page.getByRole('button');
  for (const label of navigation) {
    const button = page.getByRole('button', { name: label, exact: true });
    await button.click();
    await assert.doesNotReject(async () => {
      const className = await button.getAttribute('class');
      assert.match(className ?? '', /ant-btn-primary/, `${label} did not become active`);
    });
    await page.getByRole('heading', { name: '社区甄选管理后台' }).waitFor();
  }
  assert.equal(await buttons.filter({ hasText: /./ }).count() >= 25, true);

  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText(`当前管理员：${credentials.username}`).waitFor();
  await page.getByRole('button', { name: '商品管理', exact: true }).waitFor();

  await page.evaluate(() => { window.__ADMIN_E2E_FORCE_RENDER_ERROR__ = true; });
  await page.getByRole('button', { name: '订单管理', exact: true }).click();
  await page.getByText('当前页面加载失败').waitFor();
  await page.getByRole('heading', { name: '社区甄选管理后台' }).waitFor();
  await page.evaluate(() => { window.__ADMIN_E2E_FORCE_RENDER_ERROR__ = false; });
  await page.getByRole('button', { name: '商品管理', exact: true }).click();
  await page.getByText('当前页面加载失败').waitFor({ state: 'detached' });

  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await page.getByRole('heading', { name: '后台登录' }).waitFor();
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: '后台登录' }).waitFor();

  console.log(`L50 Admin browser smoke passed: ${navigation.length}/${navigation.length} navigation items.`);
} finally {
  await context.close();
  await browser.close();
}
