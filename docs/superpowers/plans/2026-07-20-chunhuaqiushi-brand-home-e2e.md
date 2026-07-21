# 春华秋实模块化首页与自动点击薄框架实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不修改后端业务规则的前提下，交付可替换模板的“春华秋实”品牌首页、真实商品/团购摘要，以及可在 Mac 微信开发者工具运行的首页自动点击冒烟框架。

**Architecture:** 首页采用稳定业务壳、纯视图模型、五个展示组件、模板注册表和模板主题样式。模板只控制模块顺序、显隐、文案和外观；API、金额处理、导航事件和 `data-testid` 保持稳定。Linux/Docker 跑静态契约与纯函数测试，Mac 跑 `miniprogram-automator` 真实点击。

**Tech Stack:** 微信小程序原生 JavaScript/WXML/WXSS、Node.js `node:test`、TypeScript verifier、`miniprogram-automator@0.12.1`、pnpm 9.15.4。

## Global Constraints

- 正式品牌名：`春华秋实`；副标题：`社区甄选`。
- 品牌口号精确为：`健康源于自然，温暖来自邻里`。
- 默认模板键精确为：`chunhuaqiushi`。
- 首期不实现后台模板管理、在线模板下载、拖拽搭建、用户自由切换或远程脚本。
- 模板不得配置 API 地址、订单状态规则、金额计算、支付/退款字段或任意脚本。
- 同一业务入口在不同模板下保持同一 `data-testid` 和目标页面语义。
- 首页只调用现有 `GET /api/products` 与 `GET /api/group-buys`，统一使用 `apps/miniapp/utils/api.js`。
- 金额只用整数分经 `formatYuan` 格式化；WXML 不执行 `/ 100`。
- 不修改数据库、订单、支付、退款、佣金、奖励或合规规则。
- 不建立视觉截图基线；只在失败时保存诊断截图。

---

## 文件结构

### 新增

- `apps/miniapp/pages/index/home-model.js`：把商品、团购原始响应映射为稳定首页视图模型。
- `apps/miniapp/pages/index/home-model.test.cjs`：用 `node:test` 验证金额、库存、进度和缺失字段。
- `apps/miniapp/pages/index/templates/index.js`：模板注册表、默认键和未知模板回退。
- `apps/miniapp/pages/index/templates/chunhuaqiushi.js`：模块顺序、品牌文案、服务承诺和轻量变体。
- `apps/miniapp/components/home/brand-hero/*`：品牌主视觉。
- `apps/miniapp/components/home/category-grid/*`：分类入口。
- `apps/miniapp/components/home/product-showcase/*`：商品摘要的加载、列表、空态与重试。
- `apps/miniapp/components/home/group-buy-showcase/*`：团购摘要的加载、列表、空态与重试。
- `apps/miniapp/components/home/quick-actions/*`：三个固定业务入口。
- `apps/miniapp/styles/tokens.wxss`：共享色板、圆角、阴影和间距基础类。
- `apps/miniapp/styles/themes/chunhuaqiushi.wxss`：默认模板主题。
- `apps/miniapp/assets/brand/chunhuaqiushi-logo.jpg`：用户原始 Logo 的本地首页资产；不得生成式重绘。
- `scripts/verify-l49-brand-home-local.ts`：Linux/Docker 可运行的静态契约。
- `scripts/miniapp-e2e/home-smoke.cjs`：Mac 开发者工具首页点击冒烟。
- `scripts/miniapp-e2e/home-smoke.test.cjs`：路径断言、配置探针和日志命名的纯函数测试。
- `scripts/miniapp-e2e/lib.cjs`：不依赖开发者工具的测试辅助函数。
- `docs/runbooks/miniapp-home-e2e.md`：Mac 首次配置、运行与排错手册。

### 修改

- `apps/miniapp/config.js`：增加单一模板键 `homeTemplateKey`。
- `apps/miniapp/pages/index/index.js`：改成稳定业务壳。
- `apps/miniapp/pages/index/index.wxml`：按模板 sections 组合模块。
- `apps/miniapp/pages/index/index.wxss`：仅保留页面壳布局并导入主题。
- `apps/miniapp/pages/index/index.json`：注册五个首页组件并更新标题。
- `apps/miniapp/pages/products/index.js`：接收首页分类关键词。
- `apps/miniapp/app.json`：更新品牌导航标题、背景色和文字色。
- `apps/miniapp/app.wxss`：导入共享 tokens，统一暖米白背景和正文色。
- `package.json`：加入 L49、模型测试和 Mac E2E 命令及固定依赖。
- `scripts/miniapp-e2e/package.json`：隔离点击框架依赖。
- `scripts/miniapp-e2e/pnpm-lock.yaml`：锁定 `miniprogram-automator@0.12.1`，不修改根 lock。
- `scripts/verify-all-local.sh`：在 L22 后登记 L49 静态门禁。

---

### Task 1: 建立先红的 L49 契约与纯函数测试

**Files:**
- Create: `scripts/verify-l49-brand-home-local.ts`
- Create: `apps/miniapp/pages/index/home-model.test.cjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: 当前 `apps/miniapp/pages/index/*`、`app.json` 与 `utils/api.js`。
- Produces: `verify:l49:static` 和 `test:miniapp:home-model` 两个稳定命令。

- [ ] **Step 1: 写 L49 静态契约**

验证器使用 `existsSync/readFileSync` 并聚合失败项，一次输出所有问题。它必须检查：模板默认键、五个组件注册、品牌三段文案、`/api/products` 与 `/api/group-buys` 使用统一 `request`、WXML 无 `/ 100`、固定测试标识唯一、模板配置不含 URL/脚本、敏感 API 不出现在首页文件中，以及 Mac 冒烟脚本存在。

- [ ] **Step 2: 写纯视图模型失败测试**

`home-model.test.cjs` 固定以下断言：

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeHomeProduct,
  normalizeHomeGroupBuy,
} = require('./home-model');

test('normalizes product cents and stock without leaking API shape', () => {
  assert.deepEqual(
    normalizeHomeProduct({
      product_id: 'p-1',
      name: '有机番茄',
      cover_image: 'https://img/p-1.png',
      price_cents: 3330,
      stock: 8,
      unit: '斤',
    }),
    {
      id: 'p-1',
      name: '有机番茄',
      coverImage: 'https://img/p-1.png',
      priceYuan: '33.30',
      stockLabel: '库存：8斤',
      outOfStock: false,
    },
  );
});

test('normalizes group progress and fallback labels', () => {
  assert.deepEqual(
    normalizeHomeGroupBuy({
      id: 'g-1',
      price_cents: 1990,
      current_people: 1,
      min_people: 3,
      product: { name: '邻里蔬菜包' },
      community: { name: '春华社区' },
    }),
    {
      id: 'g-1',
      name: '邻里蔬菜包',
      communityName: '春华社区',
      coverImage: '',
      priceYuan: '19.90',
      progressText: '1/3 人',
    },
  );
});
```

- [ ] **Step 3: 注册命令并确认 RED**

`package.json` 增加：

```json
{
  "verify:l49:static": "tsx scripts/verify-l49-brand-home-local.ts",
  "test:miniapp:home-model": "node --test apps/miniapp/pages/index/home-model.test.cjs"
}
```

运行：

```bash
pnpm verify:l49:static
pnpm test:miniapp:home-model
```

预期：L49 报缺少模板/组件/冒烟文件；模型测试报 `Cannot find module './home-model'`。

- [ ] **Step 4: 提交测试基线**

```bash
git add scripts/verify-l49-brand-home-local.ts apps/miniapp/pages/index/home-model.test.cjs package.json
git commit -m "test: define modular brand home contracts"
```

---

### Task 2: 实现视图模型与模板注册表

**Files:**
- Create: `apps/miniapp/pages/index/home-model.js`
- Create: `apps/miniapp/pages/index/templates/index.js`
- Create: `apps/miniapp/pages/index/templates/chunhuaqiushi.js`
- Modify: `apps/miniapp/config.js`
- Test: `apps/miniapp/pages/index/home-model.test.cjs`

**Interfaces:**
- Consumes: `formatYuan(cents): string`。
- Produces: `normalizeHomeProduct(raw)`、`normalizeHomeGroupBuy(raw)`、`resolveHomeTemplate(key)`、`DEFAULT_HOME_TEMPLATE_KEY`。

- [ ] **Step 1: 实现最小模型使测试转绿**

`home-model.js` 导出：

```js
const { formatYuan } = require('../../utils/api');

function normalizeHomeProduct(raw = {}) {
  const stockKnown = typeof raw.stock === 'number';
  const outOfStock = stockKnown && raw.stock <= 0;
  return {
    id: raw.product_id || raw.id || '',
    name: raw.name || '社区甄选好物',
    coverImage: raw.cover_image || '',
    priceYuan: formatYuan(raw.price_cents),
    stockLabel: stockKnown
      ? (outOfStock ? '库存不足' : `库存：${raw.stock}${raw.unit || ''}`)
      : '库存以门店确认为准',
    outOfStock,
  };
}

function normalizeHomeGroupBuy(raw = {}) {
  const product = raw.product || {};
  const community = raw.community || {};
  const current = Number(raw.current_people || 0);
  const minimum = Number(raw.min_people || 0);
  return {
    id: raw.group_buy_id || raw.id || '',
    name: product.name || raw.product_name || '邻里团购',
    communityName: community.name || raw.community_name || '附近社区',
    coverImage: product.cover_image || raw.cover_image || '',
    priceYuan: formatYuan(raw.price_cents),
    progressText: `${current}/${minimum} 人`,
  };
}

module.exports = { normalizeHomeProduct, normalizeHomeGroupBuy };
```

运行 `pnpm test:miniapp:home-model`，预期 2 tests passed。

- [ ] **Step 2: 实现模板配置与回退**

`templates/chunhuaqiushi.js` 只包含 `key/pageClass/brand/services/categories/sections/sectionTitles`；`sections` 顺序固定为 `brandHero, categoryGrid, productShowcase, groupBuyShowcase, quickActions`。分类键使用 `vegetables, fruits, eggs, grains, pantry`，对应关键词为 `蔬菜、水果、鸡蛋、粮油、副食`。

`templates/index.js` 实现：

```js
const chunhuaqiushi = require('./chunhuaqiushi');
const DEFAULT_HOME_TEMPLATE_KEY = 'chunhuaqiushi';
const registry = Object.freeze({ chunhuaqiushi });

function resolveHomeTemplate(key) {
  return registry[key] || registry[DEFAULT_HOME_TEMPLATE_KEY];
}

module.exports = { DEFAULT_HOME_TEMPLATE_KEY, resolveHomeTemplate };
```

`config.js` 增加 `homeTemplateKey: 'chunhuaqiushi'`。

- [ ] **Step 3: 扩展测试覆盖未知模板回退**

在模型测试中新增模板测试，断言 `resolveHomeTemplate('missing').key === 'chunhuaqiushi'`，并断言 sections 不包含未知类型。

- [ ] **Step 4: 验证并提交**

```bash
pnpm test:miniapp:home-model
node --check apps/miniapp/pages/index/home-model.js
node --check apps/miniapp/pages/index/templates/index.js
node --check apps/miniapp/pages/index/templates/chunhuaqiushi.js
git add apps/miniapp/config.js apps/miniapp/pages/index/home-model.js apps/miniapp/pages/index/home-model.test.cjs apps/miniapp/pages/index/templates
git commit -m "feat: add home view model and template registry"
```

---

### Task 3: 落地五个展示模块、主题与品牌资产

**Files:**
- Create: `apps/miniapp/components/home/{brand-hero,category-grid,product-showcase,group-buy-showcase,quick-actions}/index.{js,json,wxml,wxss}`
- Create: `apps/miniapp/styles/tokens.wxss`
- Create: `apps/miniapp/styles/themes/chunhuaqiushi.wxss`
- Create: `apps/miniapp/assets/brand/chunhuaqiushi-logo.jpg`
- Modify: `apps/miniapp/app.wxss`
- Test: `scripts/verify-l49-brand-home-local.ts`

**Interfaces:**
- Consumes: 模板中的 brand/services/categories/sectionTitles，页面中的 products/groupBuys/loading/error。
- Produces: 统一事件 `navigate({ target, id?, keyword? })` 与 `retry({ resource })`。

- [ ] **Step 1: 让组件契约保持 RED**

先运行 `pnpm verify:l49:static`，确认失败集中在组件、样式和资产缺失，而模型/模板项已通过。

- [ ] **Step 2: 创建组件协议**

每个组件 `index.json` 精确为 `{"component":true}`。事件规则：

- category-grid 点击触发 `navigate({ target: 'products', keyword })`。
- product-showcase 卡片触发 `navigate({ target: 'product-detail', id })`，错误按钮触发 `retry({ resource: 'products' })`。
- group-buy-showcase 卡片触发 `navigate({ target: 'group-buy-detail', id })`，错误按钮触发 `retry({ resource: 'groupBuys' })`。
- quick-actions 触发 target `products/group-buys/orders`。
- brand-hero 不发业务事件。

所有 `data-testid` 固定在模块内部：`home-brand`、`home-category-{{item.key}}`、`home-product-{{item.id}}`、`home-group-buy-{{item.id}}`、`home-products-entry`、`home-group-buys-entry`、`home-orders-entry`、两个 retry 标识。

- [ ] **Step 3: 写主题样式**

`tokens.wxss` 定义暖米白页面、卡片白、深绿、鼠尾草绿、嫩叶绿、丰收金、果实橙红、深棕灰、灰绿，并提供 `.cq-card/.cq-pill/.cq-section-title`。组件 WXSS 只表达自身布局，品牌色从共享类或 `.theme-chunhuaqiushi` 后代规则获取。

- [ ] **Step 4: 生成并校验品牌资产**

直接归档用户提供的原始 JPG 为 `chunhuaqiushi-logo.jpg`，并核对复制前后 SHA-256 一致。自动透明化结果只要改变苹果、三片叶子、圆环或中文字形就必须拒绝；本阶段不生成简化标，待取得原始 PNG/SVG 后再无损补充。

- [ ] **Step 5: 验证并提交**

```bash
pnpm verify:l49:static
node --check apps/miniapp/components/home/brand-hero/index.js
node --check apps/miniapp/components/home/category-grid/index.js
node --check apps/miniapp/components/home/product-showcase/index.js
node --check apps/miniapp/components/home/group-buy-showcase/index.js
node --check apps/miniapp/components/home/quick-actions/index.js
git add apps/miniapp/components/home apps/miniapp/styles apps/miniapp/assets/brand apps/miniapp/app.wxss scripts/verify-l49-brand-home-local.ts
git commit -m "feat: add Chunhua Qiushi home modules and theme"
```

---

### Task 4: 把首页接入稳定业务壳与真实数据

**Files:**
- Modify: `apps/miniapp/pages/index/index.js`
- Modify: `apps/miniapp/pages/index/index.wxml`
- Modify: `apps/miniapp/pages/index/index.wxss`
- Modify: `apps/miniapp/pages/index/index.json`
- Modify: `apps/miniapp/pages/products/index.js`
- Modify: `apps/miniapp/app.json`
- Test: `scripts/verify-l49-brand-home-local.ts`

**Interfaces:**
- Consumes: `request`、两个 normalize 函数和 `resolveHomeTemplate(config.homeTemplateKey)`。
- Produces: `loadProducts()`、`loadGroupBuys()`、`onNavigate(event)`、`onRetry(event)`。

- [ ] **Step 1: 实现页面状态与独立请求**

首页 data 至少包含 `layout/products/groupBuys/productsLoading/groupBuysLoading/productsError/groupBuysError`。只在 `onShow` 调用 `refreshHome()`，内部使用 `Promise.all([loadProducts(), loadGroupBuys()])`；两个加载器各自捕获失败，因此一方失败不会拒绝整体刷新，同时兼容较旧的小程序运行时。

`loadProducts` 请求 `/api/products`，取 `data.items || data || []` 的前四项；`loadGroupBuys` 请求 `/api/group-buys`，取前两项。各自 catch 后写页面错误文本并保留另一资源状态；finally 只关闭自己的 loading。

- [ ] **Step 2: 实现单一导航分发**

`onNavigate` 只允许以下映射：

```js
const routes = {
  products: '/pages/products/index',
  'group-buys': '/pages/group-buys/index',
  orders: '/pages/orders/index',
  'product-detail': '/pages/product-detail/index',
  'group-buy-detail': '/pages/group-buy-detail/index',
};
```

分类关键词使用 `encodeURIComponent`；详情只接受非空 id。未知 target 显示 `暂不可用` toast，不执行跳转。

- [ ] **Step 3: 按 sections 组合模块**

`index.wxml` 只循环 `layout.sections`，用明确的 `wx:if` 分派五种已注册组件；未知 type 不渲染。页面根节点类包含 `{{layout.pageClass}}`。页面业务壳不重复商品卡/团购卡内部 WXML。

- [ ] **Step 4: 让商品页消费分类关键词**

`apps/miniapp/pages/products/index.js` 的 `onLoad(options = {})` 先解码 `options.keyword || ''` 并写入 data，再调用现有 `refreshSelection/loadProducts`；搜索和直接打开行为保持兼容。

- [ ] **Step 5: 更新导航品牌并验证**

`app.json` 与首页 `index.json` 标题改为“春华秋实”，window 使用 `#FAF7EE` 背景、`black` 文字；不得更改 pages 顺序。

运行：

```bash
pnpm verify:l49:static
pnpm test:miniapp:home-model
node --check apps/miniapp/pages/index/index.js
node --check apps/miniapp/pages/products/index.js
pnpm exec tsx scripts/verify-l22-miniapp-order-center-local.ts --static-only
```

预期全部通过，然后提交：

```bash
git add apps/miniapp/pages/index apps/miniapp/pages/products/index.js apps/miniapp/app.json
git commit -m "feat: render branded modular home with live summaries"
```

---

### Task 5: 建立 Mac 微信开发者工具自动点击薄框架

**Files:**
- Create: `scripts/miniapp-e2e/lib.cjs`
- Create: `scripts/miniapp-e2e/home-smoke.test.cjs`
- Create: `scripts/miniapp-e2e/home-smoke.cjs`
- Create: `docs/runbooks/miniapp-home-e2e.md`
- Modify: `package.json`
- Create: `scripts/miniapp-e2e/package.json`
- Create: `scripts/miniapp-e2e/pnpm-lock.yaml`

**Interfaces:**
- Consumes: `WECHAT_CLI_PATH`、`MINIAPP_PROJECT_PATH`、`MINIAPP_AUTOMATION_PORT`、首页固定 `data-testid`。
- Produces: `pnpm test:miniapp:e2e-lib` 与 `pnpm e2e:miniapp:home`，失败证据写入 `/tmp/chunhuaqiushi-miniapp-e2e-<timestamp>.*`。

- [ ] **Step 1: 写辅助函数失败测试**

测试覆盖：

- 非 darwin 平台返回明确错误。
- 默认 CLI 为 `/Applications/wechatwebdevtools.app/Contents/MacOS/cli`。
- 默认项目路径解析为仓库的 `apps/miniapp`。
- route 断言忽略开头斜杠但不允许错误页面。
- 时间戳文件名不含冒号和空格。

运行 `node --test scripts/miniapp-e2e/home-smoke.test.cjs`，预期缺少 `lib.cjs`。

- [ ] **Step 2: 实现辅助函数并转绿**

`lib.cjs` 只使用 Node 内置模块，导出 `resolveE2eConfig/assertSupportedPlatform/normalizePagePath/assertPagePath/artifactPaths`。再次运行，预期全部通过。

- [ ] **Step 3: 实现真实点击脚本**

`home-smoke.cjs` 使用：

```js
const automator = require('miniprogram-automator');
const miniProgram = await automator.launch({
  cliPath: config.cliPath,
  projectPath: config.projectPath,
  port: config.port,
  trustProject: true,
});
```

流程精确为：

1. `reLaunch('/pages/index/index')`。
2. 等待并断言 `[data-testid="home-brand"]`。
3. 点击 `home-products-entry`，断言 `pages/products/index`，返回首页。
4. 点击 `home-group-buys-entry`，断言 `pages/group-buys/index`，返回首页。
5. 点击 `home-orders-entry`，断言 `pages/orders/index`。
6. 收集 `console` 与 `exception` 事件；任何异常时保存 PNG、当前 path、页面 data 摘要和堆栈。
7. finally 中关闭开发者工具连接并写日志；进程退出码保持失败。

- [ ] **Step 4: 锁定依赖与命令**

`scripts/miniapp-e2e/package.json` 精确锁定 `miniprogram-automator: 0.12.1`；根 `package.json` 增加：

```json
{
  "scripts": {
    "setup:miniapp:e2e": "pnpm --dir scripts/miniapp-e2e --ignore-workspace install --frozen-lockfile",
    "test:miniapp:e2e-lib": "node --test scripts/miniapp-e2e/home-smoke.test.cjs",
    "e2e:miniapp:home": "node scripts/miniapp-e2e/home-smoke.cjs"
  }
}
```

在 `scripts/miniapp-e2e/` 使用 pnpm 9.15.4 生成并验证独立 lock；不得修改根 `pnpm-lock.yaml`。

- [ ] **Step 5: 写 Mac 运行手册并提交**

手册给出：

```bash
WECHAT_CLI_PATH="/Applications/wechatwebdevtools.app/Contents/MacOS/cli" \
MINIAPP_PROJECT_PATH="$PWD/apps/miniapp" \
MINIAPP_AUTOMATION_PORT=9420 \
pnpm e2e:miniapp:home
```

并说明开发者工具需登录、开启 CLI/服务端口权限，失败证据位于 `/tmp`，真实支付/分享/登录仍保留真机验收。

```bash
pnpm setup:miniapp:e2e
pnpm test:miniapp:e2e-lib
git add scripts/miniapp-e2e docs/runbooks/miniapp-home-e2e.md package.json
git commit -m "test: add miniapp home click smoke harness"
```

---

### Task 6: 登记门禁并完成阶段验证

**Files:**
- Modify: `scripts/verify-all-local.sh`
- Modify: `docs/superpowers/specs/2026-07-20-chunhuaqiushi-brand-home-design.md` only if implementation reveals a factual mismatch.

**Interfaces:**
- Consumes: Task 1–5 的所有命令。
- Produces: L49 可在现有本地验收链中重复执行；Mac 点击测试保持独立，不阻塞 Linux CI。

- [ ] **Step 1: 登记静态门禁**

在 L22 后加入：

```bash
pnpm exec tsx scripts/verify-l49-brand-home-local.ts
```

不得把 Mac E2E 放入 Linux `verify:all`。

- [ ] **Step 2: 运行云端/容器可执行门禁**

```bash
set -eu
pnpm test:miniapp:home-model
pnpm test:miniapp:e2e-lib
pnpm verify:l49:static
pnpm exec tsx scripts/verify-l22-miniapp-order-center-local.ts --static-only
node --check apps/miniapp/pages/index/index.js
node --check apps/miniapp/pages/products/index.js
git diff --check
```

预期全部 exit 0，无 warning 被当作成功掩盖。

- [ ] **Step 3: 在用户 Mac 跑真实点击准入**

```bash
pnpm e2e:miniapp:home
echo "miniapp_home_e2e_exit=$?"
```

预期 `miniapp_home_e2e_exit=0`，三次页面路径断言通过，无 exception 事件。

- [ ] **Step 4: 微信开发者工具人工检查**

在 375px 等效宽度确认：无横向滚动、Logo 无白边、长商品名不撑破、商品或团购任一失败时三个固定入口仍可点、分类入口带关键词进入商品列表。真实支付、分享、登录与退款不纳入本阶段自动化。

- [ ] **Step 5: 提交门禁登记**

```bash
git add scripts/verify-all-local.sh
git commit -m "chore: register L49 brand home gate"
git status --short
```

预期仅保留用户原有且与本阶段无关的本地改动。

---

## 完成定义

- 功能分支包含一个默认 `chunhuaqiushi` 模板和明确回退。
- 常规换模板不修改首页 API、导航函数、视图模型或自动化选择器。
- 五个模块可独立调整样式和轻量变体。
- 首页显示真实商品/团购摘要，失败互不影响。
- 静态契约、模型测试、E2E 辅助测试、L22 静态门禁和 JS 语法检查均通过。
- 用户 Mac 的微信开发者工具点击冒烟通过后，才允许建立 PR。
