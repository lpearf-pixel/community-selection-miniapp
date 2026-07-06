# L20 小程序端端到端联调与 MVP 发布前收口

## 本阶段目标

L20 在 L19 商品浏览与下单入口基础上，打通小程序端从商品列表、商品详情、下单确认、mock 支付、订单详情、自提凭证、售后申请到售后进度查看的完整用户链路。本阶段只做真实 API 联调、状态处理、错误处理、发布前检查和端到端验收，不新增营销玩法。

## 小程序 API baseUrl 配置

新增 `apps/miniapp/utils/api.js` 统一管理 API 访问：

1. 优先读取 `wx.getStorageSync('API_BASE_URL')`。
2. 其次读取 `app.globalData.apiBaseUrl`。
3. 默认使用 `http://127.0.0.1:13080`。
4. `request({ url, method, data, headers })` 自动拼接 baseUrl，并自动带上本地 mock 用户身份头。
5. `getJSON(path, params)` 与 `postJSON(path, body)` 用于页面联调。

## mock 用户身份方案

新增 `apps/miniapp/utils/user.js`：

- `getMockUserIdentity()` 从本地 storage 读取 `userId` / `openid`，没有时写入默认 `miniapp-demo-openid`。
- `setMockUserIdentity({ userId, openid })` 便于开发者工具手工切换本地身份。
- `getUserHeaders()` 优先返回 `x-user-id`，否则返回 `x-openid`。

本阶段不实现正式微信登录，不调用 `wx.login`，不新增认证系统。

## 页面清单

- `pages/products/index`：商品列表。
- `pages/product-detail/index`：商品详情与可参与开团。
- `pages/orders/confirm/index`：普通购买 / 开团购买下单确认。
- `pages/orders/detail/index`：用户订单详情。
- `pages/pickup/code/index`：自提凭证。
- `pages/after-sales/apply/index`：售后申请。
- `pages/after-sales/detail/index`：售后进度。

## 商品浏览链路

商品列表页调用 `GET /api/products`，展示商品图、商品名、价格、销售规格、库存和是否有可参与开团，并覆盖 loading / error / empty 状态。

商品详情页调用 `GET /api/products/:id`，展示商品图、商品名、描述、价格、库存和 `active_group_buys`。普通购买按钮使用“立即购买”，开团入口按钮使用“参与开团”。

## 普通购买链路

下单确认页在 `type=normal` 时调用 `GET /api/products/:id` 加载商品信息，提交时调用 `POST /api/orders/normal` 创建订单，然后调用 `POST /api/payments/mock` 完成 mock 支付，成功后跳转订单详情页。

## 开团购买链路

下单确认页在 `type=group_buy` 时调用 `GET /api/products/:id` 加载商品和可参与开团信息，提交时使用 `group_buy_id` 调用 `POST /api/orders` 创建订单，然后调用 `POST /api/payments/mock` 完成 mock 支付，成功后跳转订单详情页。

## mock 支付说明

L20 继续使用现有 mock payment，页面只调用 `POST /api/payments/mock`。不接真实支付，不调用小程序支付组件。

## 订单详情

订单详情页调用 `GET /api/me/orders/:id`，展示商品名、数量、金额、订单类型、用户状态、自提信息、售后状态和脱敏手机号。页面提供查看自提凭证、申请售后、查看售后进度入口。

## 自提凭证

自提凭证页调用 `GET /api/me/orders/:id/pickup-code`，展示自提码、订单号、自提点名称、自提点地址、自提点电话、收货人和脱敏手机号。未支付订单由后端返回错误，页面展示错误提示。本阶段不生成真实二维码，不引入二维码依赖。

## 售后申请与售后进度

售后申请页调用 `POST /api/me/orders/:id/after-sales`，售后类型限定为品质问题、重量不足、缺少商品、商品拿错、商品破损、不新鲜和其他。

售后进度页调用 `GET /api/me/orders/:id/after-sales`，展示类型、状态、处理结果、原因、申请金额、确认金额、创建时间和完成时间，并覆盖 loading / error / empty 状态。

## 合规边界

- 不接真实支付。
- 不新增营销玩法。
- 不暴露成本价。
- 不暴露奖励配置。
- 不暴露内部库存扣减规则。
- 不新增自动退款。
- 不新增自动打款。
- 不新增自动报税。
- 用户端普通购买链路不展示奖励文案。

## 验收方式

运行 L20 本地验收脚本：

```bash
pnpm exec tsx scripts/verify-l20-miniapp-e2e-release-local.ts
```

脚本覆盖：

1. 商品列表、详情、可参与开团 API。
2. 普通购买、mock 支付、订单详情、自提凭证、售后申请和售后进度。
3. 开团购买、mock 支付和订单详情。
4. 小程序页面文件结构与 `app.json` 页面注册。
5. 小程序源码静态检查，确保没有真实支付调用、没有暴露内部字段，并使用脱敏手机号字段。
6. 复用统一合规扫描。

MVP 发布前仍需人工在微信开发者工具中跑通页面跳转、输入体验、错误提示和真机样式。
