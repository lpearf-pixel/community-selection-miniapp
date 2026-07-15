# L45 税务人工 Review／内部导出占位

## 目标
提供内部工作人员使用的税务人工 Review 工作台，查看开团服务奖励提现相关税务字段、维护人工 Review 状态与备注、导出 CSV 供人工核对。

## API
- `GET /api/admin/tax-records`：分页列表，支持 `page`、`page_size`、`keyword`、`tax_status`、`tax_mode`、`invoice_status`、`leader_user_id`、`withdrawal_id/source_id`、`from`、`to`。
- `GET /api/admin/tax-records/:id`：详情，包含提现、关联奖励、订单、商品、社区、审计摘要和业务事件摘要。
- `GET /api/admin/tax-records/export.csv`：内部 CSV 导出。
- `POST /api/admin/withdrawals/:id/tax-review`：人工税务 Review。

## 权限
- 读取：`finance.view`。
- CSV 导出：`finance.export`。
- 人工 Review：`withdrawal.manage`。

## Data Scope
复用 L44 `WithdrawalCommission` 关联和 `withdrawalScopeWhere`：非 `super_admin` 只能访问全部关联订单均落在其授权社区或自提点范围内的 Withdrawal；无 scope 的 finance 返回空列表。

## 金额规则
金额均使用整数分。校验 `taxable_amount_cents >= 0`、`tax_amount_cents >= 0`、`tax_amount_cents <= taxable_amount_cents`、`payable_amount_cents = amount_cents - tax_amount_cents`、`payable_amount_cents >= 0`。

## 幂等规则
`client_request_id` 写入 `TaxRecord.payload`。相同幂等键和相同 review snapshot 返回幂等结果；相同幂等键但内容不同返回 `409`。

## CSV 安全
CSV 文本字段导出前做公式注入防护，字段以 `=`、`+`、`-`、`@`、制表符、回车或换行开头时添加单引号，并进行 CSV 引号转义。

## 审计
人工 Review 成功后更新 Withdrawal，upsert 必要 TaxRecord，写入一条根 `BusinessEventLog(withdrawal_tax_reviewed)` 和一条 `AdminAuditLog`，包含 before/after snapshot 且不返回完整手机号或敏感凭证。

## 禁止自动报税与外部平台
本阶段不自动计算正式税额、不自动报税、不连接外部税务平台、不自动开票、不自动代扣代缴、不自动打款。页面和导出均标注“仅供内部人工核对，不构成税务申报结果。”。

## 验收证据
以 `scripts/verify-l45-manual-tax-review-export-local.ts`、Docker API E2E、Admin typecheck 和 L24-L45 stage workflow 输出为准。

## 未完成项
正式税务申报、外部税务平台、自动打款、税率计算引擎均不属于 L45 范围。


## Review 修复补充

- 税务状态由后端按 tax_mode / invoice_status 推导，并限制在明确枚举集合内。
- 税务复核幂等键保存到 TaxRecord.payload.review_requests 历史映射，同 key 同语义返回 idempotent，不同语义返回 409。
- CSV 导出在匹配条数超过上限时返回 422，不返回部分 CSV。
- Admin 导出使用带认证和 scope 的 fetch Blob 下载，不使用 href 直链。
- 详情 DTO 暴露 updated_at，提交 expected_updated_at 做乐观并发控制。
