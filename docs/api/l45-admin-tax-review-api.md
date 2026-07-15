# L45 税务人工 Review API 说明书

本文档描述 L45 税务人工 Review、税务记录查询与人工标记已处理接口的公开契约。

- 路由实现：`apps/api/src/routes/withdrawals.ts`
- 机器可读契约：`docs/api/contracts/l45-admin-tax-review.contract.json`
- 前端调用：`apps/admin/src/api/adminTaxReview.ts`
- Docker E2E：`scripts/verify-docker-api-e2e-local.ts`

> 业务边界：仅供内部人工核对；系统不会自动报税、不会连接外部税务平台、不会自动发起打款。

## 1. 通用约定

### 1.1 身份、权限与数据范围

所有接口都要求有效 Admin 身份。身份可来自正式会话，开发环境也可通过统一 Admin request helper 注入开发 Header。

| 接口 | 权限 | 数据范围 |
|---|---|---|
| `GET /api/admin/tax-records` | `finance.view` | Withdrawal data scope，在 count 和分页前应用 |
| `GET /api/admin/tax-records/:id` | `finance.view` | TaxRecord 关联 Withdrawal 的 data scope |
| `GET /api/admin/tax-records/export.csv` | `finance.export` | 与列表相同的筛选和 Withdrawal data scope |
| `POST /api/admin/withdrawals/:id/tax-review` | `withdrawal.manage` | Withdrawal data scope |
| `POST /api/admin/withdrawals/:id/mark-paid` | `withdrawal.manage` | Withdrawal data scope |

通用错误：

- `401`：无 Admin 身份、Admin 不存在或已停用；
- `403`：角色缺少权限，或资源不在当前 Admin data scope；
- `404`：资源不存在；
- `400`：请求字段、枚举、金额关系或参数格式非法；
- `409`：合法请求与现有幂等历史、资源状态或乐观锁发生冲突；
- `422`：CSV 匹配数量超过导出上限。

### 1.2 响应 envelope

JSON 成功：

```json
{
  "success": true,
  "data": {},
  "message": ""
}
```

JSON 失败：

```json
{
  "success": false,
  "data": null,
  "message": "错误说明"
}
```

CSV 成功响应不使用 JSON envelope。

## 2. GET `/api/admin/tax-records`

税务人工 Review 分页列表。

### 2.1 查询参数

| 参数 | 类型 | 说明 |
|---|---|---|
| `page` | integer | 默认 1，最小 1 |
| `page_size` | integer | 默认 20，最大 200 |
| `keyword` | string | 搜索公开允许字段，例如 Withdrawal ID |
| `tax_status` | string | 税务状态筛选 |
| `tax_mode` | string | 税务模式筛选 |
| `invoice_status` | string | 发票状态筛选 |
| `withdrawal_id` | string | 指定 Withdrawal |
| `source_type` | string | 当前 L45 主要使用 `withdrawal` |
| `source_id` | string | 指定来源 ID |
| `from` / `to` | ISO datetime | 创建时间范围 |

### 2.2 成功响应

```json
{
  "success": true,
  "data": {
    "items": [],
    "total": 0,
    "page": 1,
    "page_size": 20
  },
  "message": ""
}
```

列表是分页 envelope，消费者必须读取 `data.items`，不得把响应根对象当数组。

## 3. GET `/api/admin/tax-records/:id`

返回单条税务记录详情，包括：

- 税务金额与状态；
- Withdrawal 当前 `updated_at`；
- 脱敏 Leader 手机号；
- 关联 Commission、订单、商品、社区；
- 最近 AdminAuditLog；
- 最近 BusinessEventLog。

跨 data scope 返回 `403`；不存在返回 `404`。

## 4. GET `/api/admin/tax-records/export.csv`

内部人工核对 CSV。

### 4.1 规则

- 使用与列表相同的筛选和 data scope；
- UTF-8 BOM 原始字节必须为 `EF BB BF`；
- 文件名：`tax-review-YYYY-MM-DD.csv`；
- 危险公式前缀 `= + - @ tab CR LF` 必须加单引号；
- 确定性排序：`created_at desc, id desc`；
- 查询 `10000 + 1` 条；匹配超过 10000 条时返回 `422`，不返回部分 CSV；
- 成功 Header：
  - `X-Export-Total`：实际导出行数；
  - `X-Export-Truncated: false`。

## 5. POST `/api/admin/withdrawals/:id/tax-review`

提交一次人工税务复核。

### 5.1 请求字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `tax_mode` | 是 | `none` / `withheld` / `invoice` |
| `taxable_amount_cents` | 是 | 非负整数，不能超过 Withdrawal 金额 |
| `tax_amount_cents` | 是 | 非负整数，不能超过应税金额 |
| `client_request_id` | 是 | trim 后长度 1–80，幂等键 |
| `expected_updated_at` | 新 key 必填 | 必须来自详情接口；同 key 同 payload 重放时可不依赖最新版本 |
| `tax_rate_basis` | 否 | 人工依据 |
| `invoice_status` | 否 | 发票模式可用：`pending` / `verified` / `rejected` |
| `tax_remark` | 否 | 人工备注 |

客户端不能控制以下字段：

- `tax_status`：服务端推导；
- `invoice_required`：服务端由 `tax_mode` 推导；
- `payable_amount_cents`：服务端计算。

### 5.2 税务状态推导

| `tax_mode` | 条件 | `tax_status` |
|---|---|---|
| `none` | `tax_amount_cents` 必须为 0 | `completed` |
| `withheld` | 税额合法 | `calculated` |
| `invoice` | `invoice_status=verified` | `completed` |
| `invoice` | 其他允许的发票状态 | `pending_invoice` |

### 5.3 校验与状态码优先级

接口严格按以下顺序处理：

1. Admin 身份和权限；
2. Withdrawal data scope；
3. `client_request_id`、`tax_mode` 基础格式；
4. Withdrawal 是否存在；
5. 金额、枚举和税务模式组合校验；
6. 创建规范化请求 snapshot；
7. 查询幂等历史；
8. 对新 key 检查 Withdrawal 当前状态；
9. 对新 key 校验 `expected_updated_at` 并执行乐观锁；
10. 事务写入 Withdrawal、TaxRecord、AdminAuditLog、BusinessEventLog。

这意味着：

- `tax_mode=none + tax_amount_cents=1` 是非法请求，始终返回 `400`；
- 要测试“同 key 不同内容返回 409”，不同内容必须首先是一份合法 payload；
- 非法 payload 不会因为复用了旧 key 而被升级成 `409`。

### 5.4 幂等矩阵

| 场景 | 状态码 | 结果 |
|---|---:|---|
| 新 key + 合法状态 + 正确版本 | 200 | `idempotent=false`，执行写入 |
| 同 key + 同一合法语义 | 200 | `idempotent=true`，不重复写审计和事件 |
| 同 key + 不同但合法的语义 | 409 | 幂等键内容冲突 |
| 同 key + 不同且非法的 payload | 400 | 先被字段/金额校验拒绝 |
| Withdrawal 已 `paid/rejected`，同 key 同语义重放 | 200 | `idempotent=true` |
| Withdrawal 已进入终态，新 key | 409 | 不允许新增 Review |
| 新 key + 陈旧 `expected_updated_at` | 409 | 乐观锁冲突 |
| 同 key 并发 | 两个 200 | 一个 applied，一个 idempotent |

## 6. POST `/api/admin/withdrawals/:id/mark-paid`

人工标记提现已处理，不调用真实打款平台。

### 6.1 请求

```json
{
  "manual_reference": "人工参考号",
  "remark": "可选备注"
}
```

### 6.2 前置条件

- Withdrawal 状态必须为 `approved`；
- `tax_status` 必须为 `completed` 或 `calculated`；
- `payable_amount_cents >= 0`；
- 需要发票时 `invoice_status=verified`；
- 每个关联 Commission 必须同时满足：
  - `Commission.status=withdrawing`；
  - `Commission.withdrawal_id` 等于当前 Withdrawal；
  - 存在对应 `WithdrawalCommission` 关联记录。

成功后：

- Withdrawal 进入 `paid`；
- Commission 进入 `withdrawn`；
- 写入人工处理参考号、审计日志、业务事件和 `withdrawal_paid` ledger；
- 已经是 `paid` 时重复请求返回幂等成功。

## 7. 测试编写要求

1. E2E 必须在启动时读取 `docs/api/contracts/l45-admin-tax-review.contract.json`；
2. HTTP 状态码、方法、路径、并发期望应从机器契约读取，不应在测试中凭经验猜测；
3. 编写场景前必须同时阅读本文档和路由实现；
4. 每个负向用例只制造一个失败维度；
5. 测试幂等冲突时必须使用两份都合法、但规范化 snapshot 不同的 payload；
6. 测试状态迁移前必须先断言 fixture 满足生产 `where` 条件；
7. 路由实现、机器契约、本文档和 E2E 必须在同一个 PR 中同步更新。
