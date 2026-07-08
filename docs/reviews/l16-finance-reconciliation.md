# L16 财务对账与经营报表闭环

## 本阶段目标

L16 在不接真实支付、不自动打款、不自动报税的前提下，为后台管理员提供订单、支付、退款、售后、库存损耗、开团服务奖励、提现和税务审核之间的只读对账视图与 CSV 导出能力，帮助人工核账。

## API 清单

- `GET /api/admin/finance/reconciliation/overview`：经营汇总。
- `GET /api/admin/finance/reconciliation/orders`：订单级对账明细。
- `GET /api/admin/finance/reconciliation/rewards`：开团服务奖励对账明细。
- `GET /api/admin/finance/reconciliation/after-sales`：售后/退款对账明细。
- `GET /api/admin/finance/reconciliation/export.csv`：按 `type=overview|orders|rewards|after_sales` 导出 CSV。

全部接口复用现有 admin auth，未登录访问返回 401。

## 对账口径

- 金额单位统一为分，字段值为整数。
- `paid_amount`：已支付订单的 `pay_amount_cents` 汇总。
- `refunded_amount`：订单 `refund_amount_cents` 汇总。
- `net_sales_amount = paid_amount - refunded_amount`。
- 售后退款金额优先使用已审核金额，未审核时参考申请金额。
- 库存损耗估算使用损耗数量乘以商品成本价。
- 开团服务奖励估算只读取已有合法 `Commission.final_amount_cents`，不新增奖励规则。

## 开团服务奖励合规边界

- 只展示“开团服务奖励”。
- 奖励只来自开团人本人发起团购下的真实有效商品成交。
- 退款后展示现有重算/扣减结果与 `recalculated_after_refund` 标记。
- 不新增任何层级关系字段，不新增多级奖励。

## 明确不做

- 不接真实微信支付，只延续 MOCK 支付/退款能力。
- 不自动打款，提现仍走后台人工审核和人工标记。
- 不自动报税，只展示待税务审核数量。
- 不新增营销抵扣、用户等级或营销玩法。

## 验收方式

运行：

```bash
pnpm exec tsx scripts/verify-l16-finance-reconciliation-local.ts
pnpm verify:all
pnpm report:stage -- --stage=L16
```

验收脚本覆盖 admin 未授权 401、团购订单与 mock 支付基础数据、partial_refund 售后退款、overview 金额关系、订单/开团服务奖励/售后明细、CSV 导出、以及不新增多级奖励/自动打款/自动报税的合规扫描。通过时输出：

```text
L16 finance reconciliation verification passed.
```
