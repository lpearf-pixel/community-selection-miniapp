# L22 小程序订单中心体验优化

## 本阶段目标

L22 在已有用户订单中心 API 与小程序下单链路基础上，补齐小程序端“我的订单”体验闭环。用户可以查看普通购买订单和开团订单，按状态与订单类型筛选，进入订单详情，查看自提凭证，提交售后申请，并查看售后进度。

## 订单列表页

- 页面：`apps/miniapp/pages/orders/index.*`
- 调用 `GET /api/me/orders`。
- 复用小程序 `utils/api.js` 与 `utils/user.js` 自动携带 `x-user-id` 或 `x-openid`。
- 展示商品图、商品名、数量、金额、订单类型、用户可读状态、自提点名称与售后摘要。
- 支持 loading、error、empty、下拉刷新与触底分页。

## 订单详情页

- 页面：`apps/miniapp/pages/orders/detail/index.*`
- 支持从列表通过 `id` 或 `order_id` 进入。
- 调用 `GET /api/me/orders/:id`。
- 展示订单号、商品、订单类型、状态、数量、金额、自提点、收货人、`receiver_phone_masked` 与时间线。
- 订单不存在或无权限时展示错误状态。

## 自提凭证页

- 页面：`apps/miniapp/pages/pickup/code/index.*`
- 兼容 query 参数 `id` 与 `order_id`。
- 调用 `GET /api/me/orders/:id/pickup-code`。
- 展示自提码、订单号、自提点名称、地址、电话、收货人与脱敏手机号。
- 不生成二维码，不引入二维码依赖。

## 售后申请

- 页面：`apps/miniapp/pages/after-sales/apply/index.*`
- 支持从订单列表或详情进入。
- 售后类型限制为 `bad_quality`、`short_weight`、`missing_item`、`wrong_item`、`damaged`、`not_fresh`、`other`。
- 提交调用 `POST /api/me/orders/:id/after-sales`。
- `requested_refund_cents` 支持手动输入，页面不会触发自动退款。

## 售后进度

- 页面：`apps/miniapp/pages/after-sales/detail/index.*`
- 支持 query 参数 `order_id`。
- 调用 `GET /api/me/orders/:id/after-sales`。
- 展示售后记录列表；为空时展示“暂无售后记录”。
- 不新增自动退款入口。

## 筛选逻辑

订单列表支持两组筛选：

- 状态：全部、待支付、待自提、已完成、售后中、已退款。
- 类型：全部、普通购买、开团订单。

类型筛选透传到 `GET /api/me/orders` 的 `type` 参数；状态筛选优先复用已有 `status` 参数，售后中在小程序端根据售后摘要兼容筛选。

## Mock 支付说明

L22 不接真实微信支付。验收脚本仍使用 `POST /api/payments/mock` 创建已支付订单，用于验证订单中心、自提凭证与售后入口展示。

## 隐私与合规边界

- 不展示完整手机号，只展示 `receiver_phone_masked` 或等价脱敏字段。
- 不展示成本价。
- 不展示奖励配置，普通购买链路不出现奖励文案。
- 不新增营销玩法。
- 不新增 DB 表。
- 不新增 DB 字段。
- 不自动打款。
- 不自动报税。

## 验收方式

- `scripts/verify-l22-miniapp-order-center-local.ts` 覆盖后端 API E2E、小程序文件结构、小程序静态源码检查与合规扫描。
- `scripts/verify-all-local.sh` 在 L21 后执行 L22 验收脚本。
- `scripts/generate-stage-report.ts` 增加 L22 阶段报告 manifest。

## MVP 发布前人工验证

MVP 发布前仍需在微信开发者工具中手动跑通：我的入口、订单列表筛选、订单详情、自提凭证、售后申请、售后进度以及下拉刷新/触底分页体验。
