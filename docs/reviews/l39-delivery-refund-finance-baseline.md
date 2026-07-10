# L39 配送费退款与财务对账拆分基线 Review

## 阶段范围

L39 仅收口配送费退款策略、商品退款/配送费退款拆分、财务退款台账与用户订单详情展示，不扩展新业务能力。

## 配送费退款策略

- 订单金额继续拆为商品金额、配送费、实付金额，均使用整数分。
- 退款金额拆为商品退款金额与配送费退款金额。
- 总退款金额必须等于商品退款金额加配送费退款金额。
- 累计退款上限不得超过订单 `pay_amount_cents`。
- 商品退款累计不得超过商品金额剩余可退部分。
- 配送费退款累计不得超过配送费剩余可退部分。
- 未显式传入拆分时，系统按商品金额优先、配送费次之分摊退款金额，便于兼容旧调用。
- 配送费退款不参与开团服务奖励；开团服务奖励仍只基于真实有效商品成交金额。

## API 与报表范围

L39 验收只覆盖下列 API：

- `POST /api/after-sales`
- `GET /api/after-sales/:id`
- `GET /api/me/orders/:id`
- `GET /api/admin/finance/refund-ledger`
- `GET /api/admin/finance/refund-ledger/export.csv`
- `GET /api/admin/finance/reconciliation/overview`

`/api/refunds/wechat/apply` 与 `/api/refunds/wechat/notify` 如仍存在，仅为历史占位接口：不启用、不调用、不纳入 L39 行为与验收，不得作为 L39 新增 API 写入报告。

## DB 范围

L39 DB 变化仅包括：

- `Order.product_refund_amount_cents`
- `Order.delivery_refund_amount_cents`
- `Refund.product_refund_amount_cents`
- `Refund.delivery_refund_amount_cents`
- `AfterSaleCase.requested_product_refund_cents`
- `AfterSaleCase.requested_delivery_refund_cents`
- `AfterSaleCase.approved_product_refund_cents`
- `AfterSaleCase.approved_delivery_refund_cents`
- `202607100002_l39_delivery_refund_finance_baseline` migration

报告生成器不得把所有 Prisma models 泛化输出为 L39 DB 变化。

## 禁止范围

- 仍然是人工退款。
- 不接真实微信支付。
- 不接真实微信退款。
- 不自动退款。
- 不自动打款。
- 不自动报税。
- 不接真实达达 API。
- 不新增开团服务奖励结算。
- 不修改依赖清单。

## 验收说明

- L39 verifier 必须加入 `scripts/verify-all-local.sh`。
- `scripts/stage-workflow.ts` 必须注册 L39 stage verifier 与 L24-L39 chain regression。
- `scripts/generate-stage-report.ts` 必须使用 L39 manifest 输出干净的文件、API、DB 和 checklist 范围。
- 报告未完成项中不得把历史微信退款占位接口描述为阻塞 L39 合并的 TODO。
