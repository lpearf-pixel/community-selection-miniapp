# L18 用户端订单中心验收说明

## 本阶段目标

L18 在 L17.5 普通购买订单能力基础上，补齐用户端交易闭环：用户可查看自己的普通购买订单和开团订单、查看详情、查看售后进度、发起售后申请，并查看文本型自提凭证。

本阶段不新增营销玩法，不接真实微信支付，不自动退款，不自动打款，不自动报税。

## 用户身份约定

当前用户端接口复用 `resolveUserIdentity(request)` 解析模拟用户身份，不复用后台 admin session，不影响后台认证。

解析优先级：

1. Header `x-user-id`
2. Header `x-openid`
3. Query `user_id`
4. Query `openid`

传入 `user_id` 时必须能查询到 `User`；传入 `openid` 时按 `User.openid` 查询。缺少身份返回 401，用户不存在返回 404。

## API 清单

- `GET /api/me/orders`：用户订单列表，支持 `status`、`type=normal/group_buy/all`、`page`、`page_size`。
- `GET /api/me/orders/:id`：用户订单详情，仅允许查看自己的订单。
- `GET /api/me/orders/:id/after-sales`：查看指定订单售后列表。
- `POST /api/me/orders/:id/after-sales`：用户提交售后申请，复用 L15 售后服务。
- `GET /api/me/orders/:id/pickup-code`：查看已支付订单的文本型自提凭证。

## 普通订单和开团订单展示差异

订单类型由 `order.group_buy_id` 判定：

- `group_buy_id = null`：普通购买订单，`order_type = normal`，商品来自 `order.product`。
- `group_buy_id` 有值：开团订单，`order_type = group_buy`，商品优先来自 `order.group_buy.product`。

商品解析统一兼容：`order.group_buy?.product ?? order.product`。

普通订单不展示、不产生“开团服务奖励”。开团服务奖励仍只来自开团人本人发起团购下的真实有效订单。

## 售后入口规则

用户只能对自己的订单发起售后。用户端路径参数中的订单 ID 是唯一可信订单来源，Body 不允许覆盖为其他订单。

售后 `type` 仅允许 L15 的问题类型：`bad_quality`、`short_weight`、`missing_item`、`wrong_item`、`damaged`、`not_fresh`、`other`。`refund`、`partial_refund` 仍只属于后台审核/处理的 `resolution_type`。

普通订单售后不产生 Commission；开团订单售后继续沿用既有奖励重算逻辑。

## 自提凭证规则

自提凭证不新增数据库字段，按订单号稳定复算：`PICK-${order_no 后 6 位}`。

仅已支付订单可查看自提凭证。未支付订单返回业务错误。

## 手机号脱敏

自提凭证返回 `receiver_phone_masked`，格式如 `138****0000`，不返回完整手机号。

## 数据库变化

本阶段优先无数据库变化：

- 不新增表。
- 不新增 `pickup_code` 字段。
- 不新增用户订单快照表。
- 复用 `Order` / `Product` / `GroupBuy` / `AfterSaleCase` / `PickupStore` / `OrderTimelineLog`。

## 合规边界

- 不新增多级关系。
- 不新增团队、层级或发展人数计酬。
- 不新增优 惠 券、会 员、裂 变等营销玩法。
- 不接真实支付。
- 不自动退款。
- 不自动打款。
- 不自动报税。

## 验收方式

执行：

```bash
pnpm exec tsx scripts/verify-l18-user-order-center-local.ts
```

成功输出应包含：

```text
Compliance scan passed.
L18 user order center verification passed.
```

总体验证脚本 `scripts/verify-all-local.sh` 已在 L17.5 后追加 L18 验收脚本。
