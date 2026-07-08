# L17.5 普通购买订单能力 Review

## 为什么要支持普通购买

L17 已完成运营看板，本阶段在开团订单之外补齐普通商品购买订单，使实体店常规零售也能沉淀到统一订单、库存、售后、财务对账与运营看板链路中，为 L18 用户端订单中心提供底层数据能力。

## 普通订单与开团订单区别

- 开团订单：`group_buy_id` 有值，商品来自 `Order -> GroupBuy -> Product`。
- 普通订单：`group_buy_id` 为空，直接通过 `Order.product_id` 关联商品。
- 普通订单不推进团购人数、团购数量，也不依赖成团状态。
- 普通订单支付使用现有 mock 支付入口。

## 普通订单不产生开团服务奖励

普通购买订单不创建 `Commission`，不产生“开团服务奖励”。开团服务奖励仍只来自开团人本人发起团购下的真实有效订单；普通订单退款、售后也不会创建或修改任何奖励记录。

## 普通订单售后口径

售后创建时优先兼容两类商品来源：开团订单取 `order.group_buy.product_id`，普通订单取 `order.product_id`。普通订单支持现有退款类售后，退款成功后仅更新订单退款金额与售后状态。

## 财务对账口径

订单对账包含普通订单，售后对账包含普通订单售后；奖励对账只来自 `Commission`，因此普通订单自然不进入奖励对账。净销售额口径保持：已支付金额减已退款金额，金额单位仍为分。

## 运营看板口径

运营 overview / trends 统计全部订单，商品排行同时兼容 `order.group_buy?.product` 与 `order.product`。社区与自提点排行按订单上的 `community_id` 和 `pickup_store_id` 统计，开团服务奖励金额仍只来自 `Commission`。

## 数据库变化

优先复用现有 `Order` 表。本阶段仅新增可空字段 `Order.product_id` 与 `Product` 的可选关系，用于承载普通购买订单；未新增普通订单表，未新增 order items 表。

## API 清单

- `POST /api/orders/normal`：创建普通购买订单。
- `POST /api/payments/mock`：复用现有 mock 支付。
- `POST /api/after-sales`：复用现有售后申请。
- `GET /api/admin/finance/reconciliation/orders`：订单对账包含普通订单。
- `GET /api/admin/operations/dashboard/products`：商品排行包含普通订单商品。

## 合规边界

- 不新增多级关系或层级收益。
- 不新增团队、代理、下<!-- compliance split -->线、上<!-- compliance split -->级等关系字段。
- 不新增营销玩法。
- 不接真实微信支付。
- 不自动打款。
- 不自动报税。
- 普通订单不产生开团服务奖励。

## 验收方式

运行：

```bash
pnpm exec tsx scripts/verify-l17-5-normal-purchase-local.ts
```

脚本覆盖普通订单创建、无奖励、mock 支付扣库存、订单列表商品展示、售后退款、财务对账、运营商品排行与合规扫描。成功标记为：

```text
L17.5 normal purchase verification passed.
```
