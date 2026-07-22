# Mini Program Global Theme and 19-Page Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将当前“春华秋实”首页视觉升级为覆盖小程序端全部 19 个页面的全局主题系统，并保证以后切换模板时所有页面、共享组件、品牌素材和导航样式一起更新。

**Architecture:** 主题切换采用构建期单入口，不做用户侧运行时换肤。`theme.json` 是颜色、圆角、阴影、素材和导航配置的唯一来源，激活脚本生成小程序可直接使用的 WXSS/JS 配置；页面只使用语义类与共享组件，不再写死品牌视觉值。迁移按浏览购买、交易履约、账户售后三批进行，每批单独测试与提交。

**Tech Stack:** 微信小程序 WXML/WXSS/CommonJS、Node.js built-in test runner、TypeScript 静态门禁、`miniprogram-automator`、pnpm。

## Global Constraints

- 本阶段只覆盖 `apps/miniapp` 中 `app.json` 登记的 19 个页面。
- `apps/admin` 后台管理端明确延期，不修改其 React、CSS、路由或测试。
- 当前活动主题为 `chunhuaqiushi`，延续“浅色精品有机 + 清新田园”基线。
- 不修改商品、拼团、购物车、支付、库存、退款、积分、提现和履约业务规则。
- 不修改现有接口路径、请求参数、响应字段、事件处理函数名和页面跳转参数。
- 页面专属 WXSS 只允许布局尺寸与排版规则；颜色、边框、圆角、阴影、按钮、状态和媒体占位必须来自全局主题语义令牌。
- 远程合法商品图片优先；缺图、加载失败和旧占位路径统一使用活动主题提供的本地素材。
- 每批迁移必须先有失败门禁，再改页面，再运行页面测试和自动化验证。
- 继续使用 `codex/l49-brand-home-e2e` 功能分支；除非用户另行要求，不创建 PR、不合并。

## Verified Page Inventory

| 批次 | 页面 | 数量 |
|---|---|---:|
| A：浏览与选购 | `pages/index/index`、`pages/communities/index`、`pages/pickup/select/index`、`pages/products/index`、`pages/product-detail/index`、`pages/group-buys/index`、`pages/group-buy-detail/index` | 7 |
| B：交易与履约 | `pages/start-group-buy/index`、`pages/join-order/index`、`pages/cart/index`、`pages/orders/confirm/index`、`pages/orders/index`、`pages/orders/detail/index`、`pages/pickup/code/index` | 7 |
| C：账户、售后与团长 | `pages/mine/index`、`pages/after-sales/apply/index`、`pages/after-sales/detail/index`、`pages/leader/center/index`、`pages/leader/withdrawals/index` | 5 |
| 合计 | 小程序端全部页面 | 19 |

---

### L50-T01: Lock the global theme contract and project documentation

**Files:**
- Create: `docs/architecture/miniapp-global-theme-system.md`
- Create: `scripts/verify-miniapp-theme-local.ts`
- Create: `scripts/miniapp-theme/theme-contract.test.cjs`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**
- Consumes: `apps/miniapp/app.json` 的页面数组。
- Produces: `pnpm verify:miniapp:theme`，静态核验活动主题、19 页覆盖、禁用硬编码视觉值和共享组件接入情况。

- [ ] **Step 1: Write the global architecture rules**

  文档必须明确以下规则：

  ```text
  1. theme.json 是品牌视觉唯一来源。
  2. 页面只能使用 cq-* 语义类，不得直接写品牌色、阴影或圆角。
  3. 新页面加入 app.json 时，必须接入 cq-page、统一状态组件和主题门禁。
  4. 切换模板只允许执行 miniapp:theme:activate，不允许逐页改色。
  5. 首页、子页面和导航栏属于同一个主题版本。
  6. 后台管理端不在 L50 范围内。
  ```

- [ ] **Step 2: Write the failing contract tests**

  `theme-contract.test.cjs` 必须验证：

  ```js
  assert.equal(app.pages.length, 19);
  assert.equal(activeTheme.id, 'chunhuaqiushi');
  assert.match(activeWxss, /themes\/chunhuaqiushi\.wxss/);
  ```

  静态门禁同时扫描所有页面 `.wxml/.wxss/.json`，要求根节点包含 `cq-page`，并拒绝页面 WXSS 中的 `#hex`、`rgb()`、`rgba()`、`hsl()` 品牌视觉字面量。

- [ ] **Step 3: Run the contract tests and confirm RED**

  Run:

  ```bash
  node --test scripts/miniapp-theme/theme-contract.test.cjs
  ```

  Expected: FAIL，原因应为活动主题描述文件、统一页面根类和全局门禁尚不存在；不得出现业务测试失败。

- [ ] **Step 4: Add package entry points and documentation link**

  `package.json` 增加：

  ```json
  {
    "scripts": {
      "test:miniapp:theme": "node --test scripts/miniapp-theme/*.test.cjs",
      "verify:miniapp:theme": "tsx scripts/verify-miniapp-theme-local.ts"
    }
  }
  ```

  `README.md` 增加指向 `docs/architecture/miniapp-global-theme-system.md` 的“小程序主题开发规范”入口。

- [ ] **Step 5: Commit the contract and docs**

  ```bash
  git add docs/architecture/miniapp-global-theme-system.md scripts/verify-miniapp-theme-local.ts scripts/miniapp-theme/theme-contract.test.cjs package.json README.md
  git commit -m "docs(miniapp): define global theme contract"
  ```

---

### L50-T02: Build the single-source theme activation system

**Files:**
- Create: `apps/miniapp/themes/chunhuaqiushi/theme.json`
- Create: `apps/miniapp/themes/chunhuaqiushi/theme.js`
- Create: `apps/miniapp/themes/active.generated.js`
- Create: `apps/miniapp/styles/theme-active.generated.wxss`
- Create: `scripts/miniapp-theme/activate-theme.cjs`
- Create: `scripts/miniapp-theme/activate-theme.test.cjs`
- Modify: `apps/miniapp/styles/themes/chunhuaqiushi.wxss`
- Modify: `apps/miniapp/styles/tokens.wxss`
- Modify: `apps/miniapp/app.wxss`
- Modify: `apps/miniapp/app.js`
- Modify: `apps/miniapp/app.json`
- Modify: `apps/miniapp/config.js`
- Modify: `apps/miniapp/pages/index/templates/index.js`
- Modify: `apps/miniapp/pages/index/templates/chunhuaqiushi.js`
- Modify: `package.json`

**Interfaces:**
- `activateTheme(themeId, rootDir)` reads `themes/<themeId>/theme.json` and deterministically writes the active JS/WXSS files plus `app.json.window` values.
- `getActiveTheme()` returns an immutable object with `id`, `pageClass`, `assets`, `navigation`, `catalog`, `copy`, and `variants`.
- `app.globalData.theme` exposes the same immutable active descriptor to pages and components.

- [ ] **Step 1: Define the failing activation tests**

  Cover these exact behaviors:

  ```js
  assert.equal(result.themeId, 'chunhuaqiushi');
  assert.match(result.generatedJs, /require\('\.\/chunhuaqiushi\/theme'\)/);
  assert.match(result.generatedWxss, /@import "themes\/chunhuaqiushi\.wxss";/);
  assert.equal(result.window.navigationBarBackgroundColor, '#FAF7EE');
  assert.equal(result.window.navigationBarTitleText, '春华秋实');
  assert.throws(() => activateTheme('missing-theme', tempRoot), /Unknown miniapp theme/);
  ```

- [ ] **Step 2: Create the current theme descriptor**

  `theme.json` 必须包含以下稳定语义键，不允许页面依赖品牌色字段名：

  ```json
  {
    "id": "chunhuaqiushi",
    "displayName": "春华秋实",
    "pageClass": "theme-chunhuaqiushi",
    "navigation": {
      "title": "春华秋实",
      "backgroundColor": "#FAF7EE",
      "textStyle": "black"
    },
    "assets": {
      "logo": "/assets/brand/chunhuaqiushi-logo.jpg",
      "hero": "/assets/brand/chunhuaqiushi-hero.jpg",
      "catalogSprite": "/assets/catalog/chunhuaqiushi-catalog-sprite.jpg"
    }
  }
  ```

  `theme.js` 在该 JSON 基础上补充现有首页分类、品牌文案、分区顺序、状态文案和图片降级映射。

- [ ] **Step 3: Convert visual values to semantic CSS variables**

  `chunhuaqiushi.wxss` 在 `page` 与 `.theme-chunhuaqiushi` 上定义：

  ```css
  --cq-color-page: #FAF7EE;
  --cq-color-surface: #FFFDF8;
  --cq-color-brand: #315B45;
  --cq-color-brand-soft: #EAF1E7;
  --cq-color-accent: #D5A84B;
  --cq-color-price: #DF6B4F;
  --cq-color-text: #2D3A31;
  --cq-color-muted: #748078;
  --cq-color-danger: #C94F45;
  --cq-radius-card: 28rpx;
  --cq-radius-control: 18rpx;
  --cq-shadow-card: 0 12rpx 30rpx rgba(57, 76, 62, 0.08);
  ```

  `tokens.wxss` 只用 `var(--cq-*)` 定义 `.cq-page`、`.cq-card`、`.cq-title`、`.cq-muted`、`.cq-price`、`.cq-input`、`.cq-button`、`.cq-button--primary`、`.cq-button--secondary`、`.cq-button--danger`、`.cq-chip`、`.cq-divider`、`.cq-action-bar` 和 `.cq-state`。

- [ ] **Step 4: Implement deterministic theme activation**

  `activate-theme.cjs` 必须接受：

  ```bash
  node scripts/miniapp-theme/activate-theme.cjs chunhuaqiushi
  ```

  它只允许读取已登记主题，原子写入 active generated files，更新 `app.json.window`，并打印：

  ```text
  miniapp_theme=chunhuaqiushi
  miniapp_theme_files=3
  ```

  `package.json` 同时增加：

  ```json
  {
    "scripts": {
      "miniapp:theme:activate": "node scripts/miniapp-theme/activate-theme.cjs"
    }
  }
  ```

- [ ] **Step 5: Point the existing home template at the global descriptor**

  `pages/index/templates/index.js` 从 `themes/active.generated.js` 读取活动主题；旧 `pages/index/templates/chunhuaqiushi.js` 暂时保留为兼容 re-export，避免一次迁移破坏首页。

- [ ] **Step 6: Run and commit**

  ```bash
  pnpm miniapp:theme:activate chunhuaqiushi
  pnpm test:miniapp:theme
  pnpm verify:miniapp:theme
  git add apps/miniapp scripts/miniapp-theme package.json
  git commit -m "feat(miniapp): add single-source global theme"
  ```

  Expected: activation tests PASS；静态页面覆盖门禁仍因 18 个子页面尚未迁移而 FAIL。

---

### L50-T03: Add shared visual primitives and image fallback behavior

**Files:**
- Create: `apps/miniapp/components/ui/state-panel/index.js`
- Create: `apps/miniapp/components/ui/state-panel/index.json`
- Create: `apps/miniapp/components/ui/state-panel/index.wxml`
- Create: `apps/miniapp/components/ui/state-panel/index.wxss`
- Create: `apps/miniapp/components/ui/media-thumb/index.js`
- Create: `apps/miniapp/components/ui/media-thumb/index.json`
- Create: `apps/miniapp/components/ui/media-thumb/index.wxml`
- Create: `apps/miniapp/components/ui/media-thumb/index.wxss`
- Create: `apps/miniapp/components/ui/status-pill/index.js`
- Create: `apps/miniapp/components/ui/status-pill/index.json`
- Create: `apps/miniapp/components/ui/status-pill/index.wxml`
- Create: `apps/miniapp/components/ui/status-pill/index.wxss`
- Create: `scripts/miniapp-theme/ui-components.test.cjs`
- Modify: `apps/miniapp/styles/tokens.wxss`
- Modify: `scripts/verify-miniapp-theme-local.ts`

**Interfaces:**
- `<state-panel state="loading|empty|error" message="..." retryable="..." />` emits `retry`.
- `<media-thumb src="..." category-index="..." mode="aspectFill" />` keeps a valid image and switches to the active theme sprite on missing/error.
- `<status-pill text="..." tone="brand|info|success|warning|danger|neutral" />` maps business status to semantic tone; pages never pass colors.

- [ ] **Step 1: Write failing component contract tests**

  Tests must verify valid component JSON, declared properties, retry event, image `binderror`, no hard-coded color literals in component WXSS, and active-theme fallback import.

- [ ] **Step 2: Implement state-panel**

  WXML renders exactly one of loading, empty, or error state; retry button appears only when `state === 'error' && retryable`.

- [ ] **Step 3: Implement media-thumb**

  Keep `https://`, `http://`, `wxfile://`, `cloud://`, and package-local sources; missing values and `/images/products/placeholder.png` use the current catalog sprite. On `binderror`, switch once to fallback without retry loops.

- [ ] **Step 4: Implement status-pill**

  Reject arbitrary tone values and fall back to `neutral`; all visual mapping stays in global theme CSS.

- [ ] **Step 5: Run and commit**

  ```bash
  pnpm test:miniapp:theme
  pnpm verify:miniapp:theme
  git add apps/miniapp/components/ui apps/miniapp/styles/tokens.wxss scripts/miniapp-theme scripts/verify-miniapp-theme-local.ts
  git commit -m "feat(miniapp): add themed UI primitives"
  ```

---

### L50-T04: Migrate batch A — browsing and shopping discovery pages

**Files:**
- Modify: `apps/miniapp/pages/index/index.wxml`
- Modify: `apps/miniapp/pages/index/index.wxss`
- Modify: `apps/miniapp/pages/communities/index.wxml`
- Modify: `apps/miniapp/pages/communities/index.wxss`
- Modify: `apps/miniapp/pages/communities/index.json`
- Modify: `apps/miniapp/pages/pickup/select/index.wxml`
- Modify: `apps/miniapp/pages/pickup/select/index.wxss`
- Modify: `apps/miniapp/pages/pickup/select/index.json`
- Modify: `apps/miniapp/pages/products/index.wxml`
- Modify: `apps/miniapp/pages/products/index.wxss`
- Modify: `apps/miniapp/pages/products/index.json`
- Modify: `apps/miniapp/pages/product-detail/index.wxml`
- Modify: `apps/miniapp/pages/product-detail/index.wxss`
- Modify: `apps/miniapp/pages/product-detail/index.json`
- Modify: `apps/miniapp/pages/group-buys/index.wxml`
- Modify: `apps/miniapp/pages/group-buys/index.wxss`
- Modify: `apps/miniapp/pages/group-buys/index.json`
- Modify: `apps/miniapp/pages/group-buy-detail/index.wxml`
- Modify: `apps/miniapp/pages/group-buy-detail/index.wxss`
- Modify: `apps/miniapp/pages/group-buy-detail/index.json`

**Interfaces:**
- All seven roots use `cq-page`;活动主题由 `app.wxss` 对 generated WXSS 的全局导入注入，不在页面写死主题名。
- Product/group images use `media-thumb`; loading/empty/error states use `state-panel`; group status uses `status-pill`.
- Existing event names and URL query parameters remain unchanged.

- [ ] **Step 1: Extend the gate with batch-A expectations and confirm RED**

  Require all seven WXML files to contain `cq-page`; require list/detail pages to declare the relevant shared components; reject `#f7f8fa`、`#fff`、`#222`、`#f5222d`、`#1677ff` and other color literals in their WXSS.

- [ ] **Step 2: Migrate page structure without changing behavior**

  Use this exact semantic mapping:

  | Existing intent | Global class/component |
  |---|---|
  | page background/root | `cq-page` |
  | white card/panel | `cq-card` |
  | page or section heading | `cq-title` / `cq-section-title` |
  | description/stock/location | `cq-muted` |
  | selling price | `cq-price` |
  | text/search input | `cq-input` |
  | main purchase action | `cq-button cq-button--primary` |
  | secondary action | `cq-button cq-button--secondary` |
  | product/group photo | `media-thumb` |
  | loading/empty/error | `state-panel` |

- [ ] **Step 3: Preserve page-specific hierarchy**

  首页保持主视觉；商品列表强调图片、名称、价格与购买操作；商品详情保持信息密度和底部行动区；团购列表/详情突出成团状态、进度和社区信息；社区与自提点页优先展示当前选择和地址。

- [ ] **Step 4: Run batch verification**

  ```bash
  pnpm test:miniapp:home-model
  pnpm test:miniapp:theme
  pnpm verify:l49:static
  pnpm verify:miniapp:theme
  ```

  Expected: Batch A 7/7 covered；首页既有模型测试和 L49 门禁继续通过；Batch B/C 仍在迁移允许清单中。

- [ ] **Step 5: Commit batch A**

  ```bash
  git add apps/miniapp/pages/index apps/miniapp/pages/communities apps/miniapp/pages/pickup/select apps/miniapp/pages/products apps/miniapp/pages/product-detail apps/miniapp/pages/group-buys apps/miniapp/pages/group-buy-detail
  git commit -m "feat(miniapp): unify discovery pages with global theme"
  ```

---

### L50-T05: Migrate batch B — transaction and fulfillment pages

**Files:**
- Modify: `apps/miniapp/pages/start-group-buy/index.wxml`
- Modify: `apps/miniapp/pages/start-group-buy/index.wxss`
- Modify: `apps/miniapp/pages/start-group-buy/index.json`
- Modify: `apps/miniapp/pages/join-order/index.wxml`
- Modify: `apps/miniapp/pages/join-order/index.wxss`
- Modify: `apps/miniapp/pages/join-order/index.json`
- Modify: `apps/miniapp/pages/cart/index.wxml`
- Modify: `apps/miniapp/pages/cart/index.wxss`
- Modify: `apps/miniapp/pages/cart/index.json`
- Modify: `apps/miniapp/pages/orders/confirm/index.wxml`
- Modify: `apps/miniapp/pages/orders/confirm/index.wxss`
- Modify: `apps/miniapp/pages/orders/confirm/index.json`
- Modify: `apps/miniapp/pages/orders/index.wxml`
- Modify: `apps/miniapp/pages/orders/index.wxss`
- Modify: `apps/miniapp/pages/orders/index.json`
- Modify: `apps/miniapp/pages/orders/detail/index.wxml`
- Modify: `apps/miniapp/pages/orders/detail/index.wxss`
- Modify: `apps/miniapp/pages/orders/detail/index.json`
- Modify: `apps/miniapp/pages/pickup/code/index.wxml`
- Modify: `apps/miniapp/pages/pickup/code/index.wxss`
- Modify: `apps/miniapp/pages/pickup/code/index.json`

**Interfaces:**
- Transaction forms use `cq-input` and semantic button variants.
- Amount summary uses `cq-price` but refund/error values use danger semantics, never raw red.
- Fixed submission areas use `cq-action-bar` with safe-area padding.
- Order and pickup statuses use `status-pill` with a status-to-tone mapper, never direct status-to-color mapping in WXML.

- [ ] **Step 1: Add batch-B failing gates**

  Require each form/detail page that can submit、支付、开团或确认履约 to have exactly one clear primary action and a safe-area action bar where applicable. Order/list pages keep card navigation instead of adding fake primary actions. All amount classes are semantic, and no page may use raw button `type="primary"` as its sole styling mechanism.

- [ ] **Step 2: Migrate group-start, join-order and cart**

  Preserve quantity changes, selection, stock disabling, group IDs and order parameters. Visual order is product summary → quantity/conditions → amount → primary action.

- [ ] **Step 3: Migrate order confirm/list/detail**

  Preserve community, pickup/delivery choice, receiver fields, time windows, amount calculation and MOCK payment behavior. Order detail must retain after-sales and pickup-code entrances; only presentation changes.

- [ ] **Step 4: Migrate pickup code**

  Keep the pickup credential as the dominant content, with high contrast and a distinct warning state for expired/used codes while remaining inside semantic theme tones.

- [ ] **Step 5: Run business and theme regression**

  ```bash
  pnpm test
  pnpm typecheck
  pnpm test:miniapp:theme
  pnpm verify:miniapp:theme
  ```

  Expected: existing cart/order/pickup tests PASS；Batch B 7/7 covered；no request, amount, inventory or payment contract changes.

- [ ] **Step 6: Commit batch B**

  ```bash
  git add apps/miniapp/pages/start-group-buy apps/miniapp/pages/join-order apps/miniapp/pages/cart apps/miniapp/pages/orders apps/miniapp/pages/pickup/code
  git commit -m "feat(miniapp): unify transaction pages with global theme"
  ```

---

### L50-T06: Migrate batch C — account, after-sales, and leader pages

**Files:**
- Modify: `apps/miniapp/pages/mine/index.wxml`
- Modify: `apps/miniapp/pages/mine/index.wxss`
- Modify: `apps/miniapp/pages/mine/index.json`
- Modify: `apps/miniapp/pages/after-sales/apply/index.wxml`
- Modify: `apps/miniapp/pages/after-sales/apply/index.wxss`
- Modify: `apps/miniapp/pages/after-sales/apply/index.json`
- Modify: `apps/miniapp/pages/after-sales/detail/index.wxml`
- Modify: `apps/miniapp/pages/after-sales/detail/index.wxss`
- Modify: `apps/miniapp/pages/after-sales/detail/index.json`
- Modify: `apps/miniapp/pages/leader/center/index.wxml`
- Modify: `apps/miniapp/pages/leader/center/index.wxss`
- Modify: `apps/miniapp/pages/leader/center/index.json`
- Modify: `apps/miniapp/pages/leader/withdrawals/index.wxml`
- Modify: `apps/miniapp/pages/leader/withdrawals/index.wxss`
- Modify: `apps/miniapp/pages/leader/withdrawals/index.json`

**Interfaces:**
- Mine uses themed profile header plus grouped entry cards.
- After-sales pages use neutral process states; refund amounts and errors use semantic danger tone only where needed.
- Leader pages distinguish overview metrics, available/locked amounts, history and withdrawal action without changing financial calculations.

- [ ] **Step 1: Add batch-C failing gates**

  Require `mine` and leader pages to use card/metric semantics; after-sales pages must use state/status components; all five roots must use the active theme and contain no visual literals.

- [ ] **Step 2: Migrate mine and after-sales**

  Keep login/user resolution, order entrances, after-sales fields, refund limits and existing navigation unchanged. Apply page keeps form clarity; detail page renders status, reason, product refund, delivery refund and timestamp as distinct rows.

- [ ] **Step 3: Migrate leader center and withdrawals**

  Keep financial numbers and withdrawal validation untouched. Use `cq-price` for available amounts, `cq-muted` for locked/pending explanations, `status-pill` for withdrawal state and `cq-button--primary` for the only submission action.

- [ ] **Step 4: Run financial/safety regression**

  ```bash
  pnpm test
  pnpm typecheck
  pnpm test:miniapp:theme
  pnpm verify:miniapp:theme
  ```

  Expected: all 19 pages covered；refund and withdrawal tests unchanged and passing；no financial business file outside `apps/miniapp/pages` changed.

- [ ] **Step 5: Commit batch C**

  ```bash
  git add apps/miniapp/pages/mine apps/miniapp/pages/after-sales apps/miniapp/pages/leader
  git commit -m "feat(miniapp): unify account and service pages"
  ```

---

### L50-T07: Add all-page automation and future theme-switch regression

**Files:**
- Create: `scripts/miniapp-e2e/theme-routes.cjs`
- Create: `scripts/miniapp-e2e/theme-routes.test.cjs`
- Create: `scripts/miniapp-e2e/theme-smoke.cjs`
- Create: `docs/runbooks/miniapp-theme-switch.md`
- Modify: `scripts/miniapp-e2e/container-runner.cjs`
- Modify: `scripts/miniapp-e2e/home-smoke.cjs`
- Modify: `package.json`
- Modify: `docs/runbooks/miniapp-home-e2e.md`

**Interfaces:**
- `theme-routes.cjs` exports the exact 19 routes from `app.json` with fixture/query requirements.
- `theme-smoke.cjs` opens every route, asserts a visible `cq-page`, records page stack and console errors, and writes one screenshot per route.
- `miniapp:theme:check` regenerates theme artifacts in memory and fails when committed active files or `app.json.window` differ.

- [ ] **Step 1: Write failing route coverage tests**

  ```js
  assert.equal(routes.length, 19);
  assert.deepEqual(routes.map((item) => item.path), app.pages);
  assert.equal(new Set(routes.map((item) => item.screenshot)).size, 19);
  ```

- [ ] **Step 2: Implement route smoke with stable fixtures**

  Detail pages use E2E-created product/group/order/after-sale IDs; list and form pages open directly. A route succeeds only when its root exists, no `MiniProgramError` is captured, and screenshot output is non-empty.

- [ ] **Step 3: Add executable scripts**

  `package.json` adds:

  ```json
  {
    "scripts": {
      "miniapp:theme:check": "node scripts/miniapp-theme/activate-theme.cjs --check chunhuaqiushi",
      "e2e:miniapp:theme": "node scripts/miniapp-e2e/container-runner.cjs --suite theme"
    }
  }
  ```

- [ ] **Step 4: Document future template switching**

  Runbook sequence must be exact:

  ```bash
  pnpm miniapp:theme:activate chunhuaqiushi
  pnpm miniapp:theme:check
  pnpm test:miniapp:theme
  pnpm verify:miniapp:theme
  pnpm e2e:miniapp:theme
  ```

  It must also state that a new theme is incomplete until 19/19 route smoke passes; editing page colors individually is prohibited.

- [ ] **Step 5: Run full local gate**

  ```bash
  pnpm miniapp:theme:check
  pnpm test:miniapp:home-model
  pnpm test:miniapp:e2e-lib
  pnpm test:miniapp:theme
  pnpm verify:l49:static
  pnpm verify:miniapp:theme
  pnpm typecheck
  pnpm test
  ```

  Expected: theme contract 19/19、all existing tests PASS、no admin files changed。

- [ ] **Step 6: Commit automation and runbooks**

  ```bash
  git add scripts/miniapp-e2e scripts/miniapp-theme docs/runbooks package.json
  git commit -m "test(miniapp): enforce all-page theme consistency"
  ```

---

### L50-T08: Mac visual acceptance and branch publication

**Files:**
- Modify only files listed in L50-T01 through L50-T07.

**Interfaces:**
- Produces `/tmp/chunhuaqiushi-miniapp-theme-*/` containing 19 screenshots, automation log and route result JSON.

- [ ] **Step 1: Re-read the remote branch HEAD**

  Confirm `codex/l49-brand-home-e2e` has not moved since implementation began. If it moved, compare before applying any commit; never overwrite concurrent work.

- [ ] **Step 2: Run real WeChat DevTools acceptance on Mac**

  ```bash
  pnpm e2e:miniapp:theme 2>&1 | tee /tmp/miniapp-theme-e2e.log
  echo "miniapp_theme_e2e_exit=$?"
  ```

  Acceptance requires 19/19 routes rendered, no module-resolution or AppService script errors, all screenshots present, and a manual spot-check of products, order confirm, after-sales detail and leader withdrawals.

- [ ] **Step 3: Verify scope**

  ```bash
  git diff --name-only b0f505584efe1ca52f63121653d66ad1927b719d...HEAD
  ```

  Expected: only miniapp theme/pages/components, theme scripts, tests and docs; no `apps/admin`, API, Prisma migration, payment or refund service changes.

- [ ] **Step 4: Publish safely**

  Fast-forward the existing feature branch only. Re-read the new remote HEAD and compare all changed blobs with the locally verified files. Do not create or merge a PR unless the user requests it.

## Completion Criteria

- [ ] 19/19 小程序页面使用同一活动主题。
- [ ] 页面和共享组件 WXSS 不含品牌视觉硬编码。
- [ ] 首页当前视觉不回退。
- [ ] 商品、团购和缺图状态使用统一图片策略。
- [ ] 表单、按钮、金额、状态、空态、错误态和底部行动区统一。
- [ ] 交易、退款、库存、提现和履约行为未变化。
- [ ] `miniapp:theme:activate` 可以从单一主题描述生成全局配置。
- [ ] 未来新增模板必须通过 19/19 自动化和静态门禁。
- [ ] 后台管理端保持未改动，并在后续独立阶段处理。
