# L50-C2-T3-A 退款可靠命令设计

- 任务：L50-C2-T3-A
- 基线：`stable/l50-a3-4-business-base`
- 开发分支：`codex/l50-c2-t3a-refund-command`
- 日期：2026-07-25
- 上游：L50-C2-T1 订单可靠写入、L50-C2-T2 自提核销可靠命令

## 1. 结论

本阶段采用“售后退款专用命令 + 复用 C2 可靠写入原语”方案。退款金额只来自已经审核通过的售后工单，Admin 执行请求不得重新提交或上调金额。命令以订单 `expected_version` 和 Admin 范围内的 `idempotency_key` 控制并发与重放；售后工单、退款单、订单退款累计、订单版本、库存回补、消费额度、佣金、业务事件、订单时间线、管理员审计和命令回执必须在同一个 PostgreSQL 事务内提交。

本阶段只治理“退款执行写入”。不重新设计售后申请与审核规则，不实现真实微信退款 API，不处理提现、通用库存调整或配送取消。开发/测试环境允许明确的 MOCK 成功；非 MOCK 环境必须失败关闭，不得把数据库记账成功伪装成真实资金到账。

## 2. 已核验现状

### 2.1 退款入口不在可靠 Admin 边界内

`apps/api/src/routes/refunds.ts` 仍公开：

- `GET /api/refunds`
- `GET /api/refunds/:id`
- `POST /api/refunds/mock`
- `POST /api/refunds/wechat/apply`
- `POST /api/refunds/wechat/notify`

其中 `POST /api/refunds/mock` 可直接执行退款记账，但路径不受 `/api/admin*` 的管理员认证、`refund.manage` 或 data scope 保护。真实微信申请尚未实现，notify 也只返回拒绝或 501。

### 2.2 售后解决存在跨事务窗口

`resolveAfterSaleCase()` 当前分三段执行：

1. 第一个事务把售后工单改为 `processing` 并写日志；
2. 独立调用 `createMockRefund()`，由第二个事务创建并完成退款；
3. 第三个事务把售后工单改为 `resolved` 并关联 `refund_id`。

任一中间步骤失败都会留下“售后处理中但退款已完成”或“退款已完成但售后未关联”等部分状态。并发请求还可能重复进入解决流程。

### 2.3 现有 C2 原语可复用

- `Order.version` 已用于乐观并发。
- `AdminCommandReceipt` 已按 `admin_user_id + idempotency_key` 唯一。
- C2-T1/T2 已建立请求哈希、幂等回放、当前权限与 data scope 复查、条件更新、V1 envelope 和结构化错误码。
- 现有退款服务已实现退款拆分、剩余可退校验、退款单、库存回补、消费额度退回、佣金同步、业务事件、订单时间线和审计，但需要改造成可加入调用方事务的内部原语。

## 3. 方案比较

### 3.1 方案 A：只给旧 `createMockRefund()` 外层增加 Admin 路由

优点是改动最少。缺点是售后、退款、关联仍跨三个事务，`expected_version` 无法约束整个写入，重放也只能依赖退款表的旧幂等字段。否决。

### 3.2 方案 B：建立所有高风险写入共用的泛化命令平台

优点是退款、提现、库存调整可一次统一。缺点是本阶段会同时引入多种目标、状态机和副作用，扩大资金风险与 PR 体量。否决；T3-B/T3-C 可在本任务验证后复用小型原语。

### 3.3 方案 C：退款专用执行器复用 C2 原语

新增售后退款专用解析器和执行器，保持领域状态机独立，但复用 `AdminCommandReceipt`、权限、scope、V1 envelope 和条件更新模式。退款领域副作用通过接收 `Prisma.TransactionClient` 的内部函数参与同一事务。推荐。

## 4. API 合同

### 4.1 新写入口

```http
POST /api/admin/after-sales/:id/refund-execute
Permission: after_sale.manage + refund.manage
Content-Type: application/json

{
  "expected_version": 7,
  "idempotency_key": "admin-refund-<uuid>",
  "admin_remark": "审核通过，执行退款"
}
```

`:id` 是售后工单 ID。请求体不接受总退款、商品退款或配送费退款金额；金额只能读取该工单已经审核的 `approved_*_refund_cents`。

成功响应使用 C1 V1 envelope，`data` 至少包含：

```json
{
  "after_sale_case_id": "case-id",
  "order_id": "order-id",
  "refund_id": "refund-id",
  "refund_status": "success",
  "refund_amount_cents": 3330,
  "product_refund_amount_cents": 3000,
  "delivery_refund_amount_cents": 330,
  "remaining_refundable_amount_cents": 0,
  "order_status": "refunded",
  "version": 8,
  "execution_mode": "mock"
}
```

### 4.2 命令资格

只有同时满足以下条件才可执行：

- 当前管理员有效并同时拥有 `after_sale.manage`、`refund.manage`；
- 管理员当前 data scope 可访问工单对应订单；
- 售后工单状态为 `approved`；
- `resolution_type` 为 `refund` 或 `partial_refund`；
- `approved_refund_cents` 为正整数；
- 已审批商品退款与配送费退款之和等于审批总额；
- 审批金额不超过订单当前各自剩余可退金额和总剩余可退金额；
- 订单已支付且仍处于现有退款服务允许的状态；
- 订单当前 `version` 等于 `expected_version`；
- 运行环境明确允许 MOCK 退款；非 MOCK 环境不得写入。

### 4.3 幂等与并发

操作名固定为 `admin.after_sale.refund.execute.v1`。请求哈希包含：

- 售后工单 ID；
- 订单 ID；
- `expected_version`；
- 规范化后的 `admin_remark`；
- 服务端读取的审批退款拆分。

同一管理员、同一幂等键、同一请求哈希成功重放时返回原始结果，不重复退款、回补库存、返还额度、冲销佣金或写日志。相同键但不同请求返回 409。重放前必须重新检查当前管理员权限和订单 data scope。

不同幂等键并发执行同一售后退款时，只有一个事务可通过订单版本和售后状态条件更新；其他请求返回 409，不得产生部分副作用。

## 5. 事务数据流

单个 PostgreSQL 事务按以下顺序执行：

1. 创建未完成的 `AdminCommandReceipt`。
2. 读取售后工单和订单，检查权限、scope、状态、审批拆分、MOCK 模式和 `expected_version`。
3. 条件更新售后工单：`approved -> processing`。
4. 创建唯一退款单，使用命令回执派生的内部 `client_refund_id`。
5. 以 `id + version + 当前退款累计` 条件更新订单退款累计、退款状态、必要的订单状态，并将 `version + 1`。
6. 执行库存回补、消费额度退回和佣金同步；这些函数必须使用同一个 `TransactionClient`。
7. 更新退款单为 `success`，再将售后工单更新为 `resolved` 并关联 `refund_id`。
8. 写入售后日志、业务事件、订单时间线和管理员审计。
9. 完成命令回执并存储稳定响应。
10. 提交事务。

任一步失败必须整体回滚，包括回执占位；不得留下 `processing` 工单、孤立退款单、已变更订单、库存流水或审计记录。

## 6. 代码边界

### 6.1 新增

- `apps/api/src/modules/refund/admin-refund-command.ts`：解析、规范化、类型和请求哈希。
- `apps/api/src/modules/refund/admin-refund-executor.ts`：资格、幂等、并发、事务和错误映射。
- 对应单元测试、真实 PostgreSQL 集成测试和路由集成测试。
- Admin 客户端函数与售后工作台执行退款 hook/交互。
- T3-A source contract 和真实 Admin 浏览器场景。

### 6.2 修改

- `refund-service.ts`：提取可接收 `TransactionClient` 的退款领域原语；保留现有非 Admin 调用兼容所需的薄包装。
- `after-sale-service.ts`：退款类 `resolveAfterSaleCase()` 不再跨事务直接调用 `createMockRefund()`；退款执行由新命令负责。非退款 resolution 保持现有行为。
- Admin after-sale route：注册新 V1 命令入口；旧 `resolve` 不再隐式执行退款。
- `routes/refunds.ts`：移除公开 MOCK 写入口和未实现的公开 apply 入口；真实 notify 占位保持 fail-closed。退款查询继续由已有 Admin 订单详情和财务退款台账提供。
- Admin 售后工作台：只有已批准且满足退款类型的工单显示执行按钮；提交后按订单/工单 ID 刷新；409 时刷新最新版本和状态。

### 6.3 不修改

- 用户售后申请金额规则；
- Admin 审核时“只能下调、不能上调”的规则；
- 真实微信退款签名、请求和回调；
- 提现、通用库存调整、配送取消；
- POS、设备和渠道同步；
- C2-T1/T2 已稳定的状态和自提命令语义。

## 7. 错误合同

| HTTP | code | 含义 |
|---|---|---|
| 400 | `INVALID_ADMIN_REFUND_COMMAND` | 请求格式或 MOCK 模式不合法 |
| 401 | `ADMIN_UNAUTHORIZED` | 管理员身份无效 |
| 403 | `ADMIN_FORBIDDEN` | 权限不足或当前 data scope 不允许 |
| 404 | `ADMIN_AFTER_SALE_NOT_FOUND` | 售后工单或订单不存在 |
| 409 | `ADMIN_IDEMPOTENCY_KEY_REUSED` | 幂等键对应不同请求 |
| 409 | `ADMIN_ORDER_VERSION_CONFLICT` | 订单版本已变化 |
| 409 | `ADMIN_REFUND_STATE_CONFLICT` | 工单状态、类型或订单状态不再允许退款 |
| 409 | `ADMIN_REFUND_AMOUNT_CONFLICT` | 审批金额超过当前剩余可退金额 |
| 503 | `ADMIN_REFUND_PROVIDER_UNAVAILABLE` | 非 MOCK 环境尚未接入真实退款提供方 |
| 500 | `ADMIN_REFUND_EXECUTION_FAILED` | 未分类内部失败，响应不得泄露内部异常 |

## 8. 验证设计

### 8.1 单元合同

- 解析器拒绝缺失或非法 `expected_version`、幂等键和备注；
- 请求体出现任意退款金额字段即拒绝；
- 请求哈希稳定，服务端审批拆分变化会改变哈希；
- 结果回放类型检查拒绝损坏回执；
- 非退款类型或非 approved 工单不可执行。

### 8.2 真实 PostgreSQL

- 正常部分退款和全额退款；
- 相同管理员相同键重放只产生一份退款与副作用；
- 相同键不同请求返回 409；
- 两个不同键并发同一工单只允许一个成功；
- 旧版本返回 409；
- 跨社区/门店 scope 返回 403；
- replay 时权限或 scope 已丢失返回 403；
- 退款拆分或剩余金额变化返回 409；
- 非 MOCK 环境返回 503 且零写入；
- 在退款单、订单、库存、额度、佣金、事件、时间线、审计、工单关联和回执的注入失败点上证明全回滚。

### 8.3 Admin 浏览器

E2E 必须创建真实已支付订单和真实售后工单，完成审核后从售后工作台执行 MOCK 退款：

- 页面展示服务端审批金额且不可编辑；
- 两个浏览器上下文并发点击得到 200/409；
- 成功后同一工单变为已解决、订单版本加一、退款台账只出现一条；
- 冲突页面刷新，不展示虚假成功；
- 非 MOCK 环境按钮禁用并解释“真实退款尚未接入”。

### 8.4 发布门禁

- 聚焦单元与 source contracts；
- 真实 PostgreSQL 集成；
- `pnpm verify:all`；
- 真实 Admin 浏览器；
- 基线审计；
- 安全与原子性代码审查，无 Critical/Important 后才允许将 Draft PR 转为可审查。

## 9. 完成定义

T3-A 只有在以下条件同时成立时完成：

- 公共 MOCK 退款写入口不可再绕过 Admin 认证；
- 售后退款执行只有新 Admin 命令一个写边界；
- 金额只能来自服务端已审批值；
- 版本、幂等、权限、scope、事务与结构化错误均有运行时证据；
- 非 MOCK 环境失败关闭；
- 全部退款副作用与售后关联原子提交；
- Admin 页面和真实浏览器场景通过；
- 未混入 T3-B、T3-C 或配送取消。
