# L29 Admin 退款台账页面 + 财务退款对账

## 本阶段目标

L29 基于 L28 已提供的后台退款台账 API，在 Admin 前端新增“退款台账”页面，帮助运营和财务人员查看人工退款记录、筛选退款订单、查看当前筛选条件下的汇总金额，并导出后端生成的 CSV。

## Admin 页面入口

- 后台菜单新增：退款台账。
- 页面组件：`apps/admin/src/pages/finance/FinanceRefundLedgerPage.tsx`。
- API client：`apps/admin/src/api/financeRefundLedger.ts`。

## 页面筛选能力

页面顶部提供筛选区，支持：

- 订单号 `order_no`
- 团购 ID `group_buy_id`
- 退款状态 `status`
- 退款方式 `refund_method`
- 开始时间 `from`
- 结束时间 `to`
- 社区 `community_id`
- 自提点 `pickup_store_id`
- 查询和重置

## 汇总能力

页面展示当前筛选条件下的：

- 退款笔数 `refund_count`
- 退款总金额 `refund_amount_cents`，前端格式化为元

## 表格字段

表格展示：

- `refund_id`
- `order_no`
- `group_buy_id`
- `product_name`
- `refund_status`
- `refund_method`
- `refund_amount_cents`
- `refund_transaction_id`
- `out_refund_no`
- `manual_record_only`
- `receiver_name`
- `receiver_phone_masked`
- `reason`
- `admin_remark`
- `created_at`
- `processed_at`

无数据时显示“暂无退款记录”，避免让财务人员误以为系统已执行自动退款。

## CSV 导出说明

页面点击“导出 CSV”时调用：

- `GET /api/admin/finance/refund-ledger/export.csv`

导出保留当前筛选条件，前端不重新拼接 CSV 内容，只负责下载后端返回的文件。默认文件名形如：`refund-ledger-YYYYMMDD-HHmm.csv`。

## 安全字段边界

- Admin 页面只展示 `receiver_phone_masked`。
- Admin 页面不展示完整收货手机号。
- 页面和 API client 不暴露内部成本字段、库存扣减字段、认证密钥字段、审计快照字段。
- CSV 下载沿用 L28 后端输出，不在前端打印敏感数据。

## 为什么仍然不自动退款

L29 仅增加财务操作视图和 CSV 下载入口，帮助人工核对退款台账。系统仍保持人工退款记录模式，不调用真实微信退款 API，不自动退款，不自动打款，不自动报税。

## 与 L28 API 的关系

L28 已提供退款台账查询与导出 API。L29 只消费这些 API：

- `GET /api/admin/finance/refund-ledger`
- `GET /api/admin/finance/refund-ledger/export.csv`

本阶段不修改 L28 后端核心逻辑。

## 数据库影响

- 无新增表。
- 无新增字段。
- 不新增 migrations。
- 不修改 Prisma schema。

## 奖励结算边界

L29 不新增奖励结算，只展示退款台账和财务退款对账视图。既有“开团服务奖励”规则不在本阶段变更。

## 后续建议

L30 可在进入真实微信支付 / 退款 API 前，先设计风控、幂等、对账差异处理和人工复核流程；这些能力不在 L29 实现。
