# L28 退款台账 / 财务对账增强 Review

## 阶段范围

本阶段基于 L27 团购失败人工退款流程，补齐后台财务视角的退款台账与对账能力。系统只记录人工退款结果，不调用真实微信退款 API，不自动退款。

## 已完成能力

- 新增后台退款台账接口：`GET /api/admin/finance/refund-ledger`。
- 新增退款台账 CSV 导出：`GET /api/admin/finance/refund-ledger/export.csv`。
- 财务对账导出支持 `type=refunds`，并补充 `GET /api/admin/finance/reconciliation/refunds`。
- 支持按订单号、团购 ID、退款状态、退款方式、时间范围筛选。
- 返回退款金额汇总：`summary.refund_amount_cents` 与 `summary.refund_count`。
- 响应只返回 `receiver_phone_masked`，不暴露完整手机号。
- CSV 防公式注入：对 `= + - @ tab CR` 开头的单元格加 `'` 前缀。

## 合规与边界

- 不调用真实微信退款 API。
- 不自动退款。
- 不自动打款。
- 不自动报税。
- 不新增奖励结算。
- 不新增多级、团队、代理玩法。
- 不新增优惠券、会员、裂变玩法。
- 不修改 Prisma schema / migrations，复用现有 `Order` 与 `Refund` 字段。

## 验证

- L28 验收脚本：`scripts/verify-l28-refund-ledger-finance-local.ts`。
- 阶段工作流：`pnpm exec tsx scripts/stage-workflow.ts --stage=L28 --publish --push`。
