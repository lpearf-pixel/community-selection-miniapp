# L40 Admin 订单详情增强 / 售后审核工作台

## 范围

- 已读取 `docs/plans/next-stage-development-plan.md`。
- 本 PR 只实现 L40。
- Admin 订单详情增强。
- 售后审核工作台。
- L39 退款拆分复用。

## 权限、安全与边界

- `GET /api/admin/orders/:id` 使用 `order.view`。
- 售后列表、详情使用 `after_sale.manage`。
- 售后审核使用 `after_sale.manage` 或 `refund.manage`。
- 保留 Admin data scope。
- 手机号和地址默认脱敏。
- 不接真实退款，不自动退款，不自动打款，不自动报税。
