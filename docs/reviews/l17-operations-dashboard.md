# L17 运营日报与经营看板

## 本阶段目标

在 L15 售后与 L16 财务对账基础上，为后台管理员提供运营概览、近 7 日趋势、商品/社区/自提点排行、异常提醒和 CSV 导出能力，帮助日常经营决策。

## API 清单

- `GET /api/admin/operations/dashboard/overview`
- `GET /api/admin/operations/dashboard/trends`
- `GET /api/admin/operations/dashboard/products`
- `GET /api/admin/operations/dashboard/communities`
- `GET /api/admin/operations/dashboard/pickup-stores`
- `GET /api/admin/operations/dashboard/alerts`
- `GET /api/admin/operations/dashboard/export.csv`

以上接口均复用现有后台管理员认证；未登录管理员返回 401。

## 运营指标口径

- `gross_sales_amount`：订单原始金额合计。
- `paid_amount`：已支付订单实收金额。
- `refunded_amount`：已退款金额。
- `net_sales_amount = paid_amount - refunded_amount`。
- `after_sale_rate = after_sale_case_count / paid_order_count`，分母为 0 时返回 0。
- `refund_rate = refunded_amount / paid_amount`，分母为 0 时返回 0。
- `pickup_completion_rate = pickup_completed_count / order_count`，分母为 0 时返回 0。
- `service_reward_amount`：开团服务奖励金额，仅统计现有真实订单关联的奖励记录。

## 金额与 rate

- 所有金额单位均为分，字段命名保留后端统一口径。
- `rate` 类字段使用 0-1 小数，例如 `0.125`。
- 只读报表中聚合空值使用 0 兜底，不把兜底值写回数据库。

## 数据库边界

本阶段不新增表，不新增定时任务，不做日报快照入库。数据实时聚合查询，复用现有：

- Order
- Product
- Category
- GroupBuy
- Community
- PickupStore
- AfterSaleCase
- Refund
- Commission
- InventoryLoss
- Batch

## 合规和业务边界

- 不接真实微信支付。
- 不自动打款。
- 不自动报税。
- 不新增营销玩法。
- 不新增多层级关系。
- 奖励相关文案只使用“开团服务奖励”。
- 经营异常提醒只用于后台查看，不自动触发营销动作、处罚或打款。

## 验收方式

执行：

```bash
pnpm exec tsx scripts/verify-l17-operations-dashboard-local.ts
pnpm verify:all
pnpm report:stage -- --stage=L17
```

验收脚本覆盖未登录 401、测试数据创建、overview/trends/products/communities/pickup-stores/alerts/export.csv、合规扫描和成功标记：

```text
L17 operations dashboard verification passed.
```
