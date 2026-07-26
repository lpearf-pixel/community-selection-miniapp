# L50-C3 退款成功链数据所有权治理设计

- 任务：`L50-C3`
- 基线：`stable/l50-a3-4-business-base`
- 基线提交：`74dd7f931fbc98b2a1812a001a1cdeaca9930963`
- 开发分支：`codex/l50-c3-refund-domain-ownership`
- 日期：2026-07-26
- 上游：L50-C2 可靠退款命令、L50-C3 支付成功链所有权治理

## 1. 结论

采用“同步 PostgreSQL 事务 + 两层编排 + 领域 owner 窄接口”治理退款成功链。

`admin-refund-executor` 继续作为可靠后台命令入口，只处理管理员权限、幂等回执、错误映射和事务编排；`refund-service` 保留退款业务编排职责，但不再直接写 `Refund`、`Order`、`AfterSaleCase`、`ConsumerCreditLedger`、`Product`、`StockLedger` 或 `Commission`。各领域 owner 在同一事务中完成写入，任一必要领域写入、业务事件、时间线或审计失败时整笔退款回滚。

本切片保持现有部分/全额退款金额规则、MOCK 退款 DTO、管理员命令合同、库存回补策略、消费额度规则和开团服务奖励规则。不接真实微信退款，不修改前端、Prisma schema、迁移或对外 API。

## 2. 已核验现状

### 2.1 后台退款执行器

`apps/api/src/modules/refund/admin-refund-executor.ts` 当前在同一事务中：

1. 创建 `AdminCommandReceipt`；
2. 直接把 `AfterSaleCase` 从 `approved` 改为 `processing`；
3. 调用 `applyMockRefundInTransaction()`；
4. 再直接把 `AfterSaleCase` 改为 `resolved` 并关联 `refund_id`；
5. 写售后日志、业务事件、订单时间线、管理员审计和命令回执。

可靠命令、版本冲突和回执重放已具备，但售后状态写入归属仍在执行器中。

### 2.2 退款服务

`apps/api/src/services/refund-service.ts` 当前同时：

1. 创建和更新 `Refund`；
2. 写 `Order.refund_*`、`refund_status`、`order_status` 和版本；
3. 调用库存回补，同时库存 owner 反向更新 `Refund.stock_restored`；
4. 直接查询并创建 `ConsumerCreditLedger`；
5. 调用奖励调整；
6. 写业务事件、订单时间线和退款审计。

这使退款渠道编排必须了解多个领域表，也让同订单并发退款的正确性分散在调用入口。Admin 入口使用 `expected_order_version`，但公共 `createMockRefund()`/`markRefundSuccess()` 仍可能在并发事务中基于同一旧累计退款金额计算。

## 3. 方案比较

### 3.1 方案 A：同步事务内按领域 owner 编排（采用）

保持模块化单体和单库事务。每个 owner 暴露退款链所需的最小命令，编排层不直接写领域表。它与刚完成的支付成功链模式一致，改动可控，能同时解决所有权、幂等、并发累计金额和整单回滚。

### 3.2 方案 B：只拆 Admin 售后状态写入

改动最小，但 `refund-service` 仍直接写订单、消费额度和退款记录；将来接微信退款或其他入口时仍需复制跨域知识。

### 3.3 方案 C：重构完整售后与退款模块

同时处理申请、审核、退款提供方、退款通知、库存损耗和全部售后状态。长期更完整，但回归面过大，不适合作为一个可独立验收的 C3 切片。

## 4. 领域所有权与窄接口

### 4.1 Refund owner

新增 `apps/api/src/modules/refund/refund-record-service.ts`，只读写 `Refund`：

```ts
findRefundByClientKey(tx, input): Promise<Refund | null>;
createPendingRefund(tx, input): Promise<Refund>;
confirmRefundSuccess(tx, refundId, notifyInfo): Promise<Refund>;
setRefundStockRestored(tx, refundId, restored): Promise<Refund>;
```

它负责退款幂等键、外部退款号匹配、成功事实、`processed_at`、`raw_notify` 和 `stock_restored` 最终投影。先在事务内确认退款成功事实，使现有库存 owner 可以验证退款状态；库存回补后再由 Refund owner 写 `stock_restored`。后续步骤失败仍会让整个事务回滚。已有成功退款只允许幂等补齐尚为空的 provider `refund_id`/通知，不重复触发其他领域副作用。

### 4.2 Order owner

新增 `apps/api/src/modules/order/order-refund-service.ts`，只写 `Order`：

```ts
lockRefundableOrder(tx, orderId): Promise<Order>;
projectRefundSuccess(tx, input): Promise<RefundedOrderProjection>;
recordRefundOrderEffects(tx, input): Promise<void>;
```

`lockRefundableOrder()` 必须在计算剩余可退金额前执行 `SELECT ... FOR UPDATE`，然后读取最新订单。`projectRefundSuccess()` 以锁后的累计金额计算商品、配送费和总退款投影；Admin 入口继续检查 `expected_order_version` 并原子递增版本。全额退款把订单改为 `refunded`，部分退款保留当前履约状态，规则不变。

同一订单的所有退款成功事务因此按订单行串行化。两笔不同幂等键的部分退款不能都基于旧余额通过；后一笔必须看到前一笔提交后的累计退款金额并重新校验。

### 4.3 AfterSale owner

在售后模块增加退款执行专用窄接口：

```ts
claimApprovedAfterSaleForRefund(tx, input): Promise<AfterSaleCase>;
resolveAfterSaleWithRefund(tx, input): Promise<AfterSaleCase>;
```

第一个接口使用 `id + status = approved` 条件认领并推进为 `processing`；第二个接口只允许对应 `processing` 工单推进到 `resolved`、关联 `refund_id` 和 `resolved_at`。售后日志由该 owner 记录。`admin-refund-executor` 不再直接调用 `tx.afterSaleCase.update*`。

### 4.4 Inventory owner

继续复用 `restoreInventoryForRefund()` 对 `Product` 和 `StockLedger` 的幂等回补，但移除它对 `Refund.stock_restored` 的反向写入。库存 owner 返回：

```ts
{
  applied: boolean;
  idempotent: boolean;
  quantity: number;
  ledger_id: string | null;
}
```

Refund owner 根据返回值写自己的 `stock_restored` 投影。只有全额商品退款且仍有可回补数量时自动回补；纯配送费退款和部分金额退款不自动回补，现有触发条件保持不变。本切片不额外引入履约阶段策略变更。

### 4.5 Consumer Credit owner

新增 `apps/api/src/modules/consumer-credit/order-refund-credit-service.ts`：

```ts
returnOrderCreditAfterFullRefund(tx, input): Promise<CreditReturnResult>;
```

该 owner 独占 `ConsumerCreditLedger` 写入，使用订单级幂等来源 `order_refund + order_id`。只有全额退款、订单使用了 `reward_conversion` 消费额度且尚未退回时创建一笔入账；部分退款继续不自动返还消费额度。

余额计算与流水创建必须在同一订单锁保护的事务中完成，避免重复并发回调创建两笔返还。

### 4.6 Commission owner

继续复用：

```ts
syncCommissionAfterRefund({ order_id, refund_id }, tx);
```

奖励 owner 继续独占 `Commission` 与奖励流水写入。商品部分退款按剩余有效商品金额重算；全额商品退款取消未结算奖励；已转换或提现状态继续进入人工复核，不自动追款。

### 4.7 Audit 与命令回执

`AdminCommandReceipt` 和管理员审计属于可靠命令基础设施，仍由 Admin 执行器负责。Refund、Order、AfterSale、Credit 和 Inventory 的必要业务事件/时间线由对应 owner 用严格写接口记录，不吞掉错误。纯拒绝原因或不影响账务结果的告警可继续使用安全告警接口。

## 5. 事务数据流

### 5.1 Admin 售后退款

一个 `executeAdminRefundCommand()` 事务按以下顺序执行：

1. Admin 执行器创建命令回执；
2. AfterSale owner 重新加载、校验并条件认领工单；
3. Order owner 锁定订单行并读取最新累计退款状态；
4. Refund 编排层校验金额拆分、幂等键和 provider 信息；
5. Refund owner 创建或加载退款记录；
6. Refund owner在事务内确认退款成功事实；
7. Order owner投影累计退款金额和订单状态；
8. Inventory owner按策略幂等回补，Refund owner随后写库存回补投影；
9. Credit owner在全额退款时幂等返还消费额度；
10. Commission owner调整开团服务奖励；
11. AfterSale owner完成工单并关联退款；
12. 各 owner 写必要事件/时间线，Admin 执行器写管理员审计和完成回执；
13. 提交事务。

任一步失败，命令回执、售后状态、退款事实、订单金额、库存、消费额度、奖励和审计全部回滚。

### 5.2 直接 MOCK 退款与 provider 成功通知

`createMockRefund()` 和 `markRefundSuccess()` 使用同一 Order 行锁和 owner 编排。它们不经过 AfterSale owner 或 Admin 回执，但退款、订单、库存、消费额度、奖励和审计的写入顺序及回滚语义相同。

### 5.3 重复与并发

- 同一 `client_refund_id` 且输入一致：返回原结果，不重复累计金额或副作用；
- 同一幂等键但金额/订单不同：保持现有冲突错误；
- 同一退款成功通知重复到达：允许补齐 provider 标识，不重复回补、返还额度、调整奖励或写成功时间线；
- 同订单不同退款并发：Order 行锁串行化，后一事务按最新剩余金额重新校验；
- 两个管理员并发执行同一工单：AfterSale 条件认领和命令回执唯一键保证最多一个成功；
- 任意唯一键竞争：只在请求哈希一致且已有回执完成时重放成功结果，否则返回现有冲突错误。

## 6. 错误与兼容

- `executeAdminRefundCommand()`、`applyMockRefundInTransaction()`、`createMockRefund()` 和 `markRefundSuccess()` 的公开签名保持不变；
- Admin 成功 DTO、HTTP 状态、错误 code 和中文文案保持不变；
- `MOCK_WECHAT_PAY !== true` 时仍返回 provider unavailable；
- 部分退款不可上调超过订单当前剩余可退金额；
- 商品退款与配送费退款之和必须等于总退款金额；
- 不改变库存回补、消费额度返还或开团服务奖励计算规则；
- 不重算或回退已经成功的 `GroupBuy` 状态；
- 不新增异步消息、outbox/inbox、微服务或外部支付调用。

## 7. 测试与验收

### 7.1 源码所有权合同

- `refund-service.ts` 不直接出现 `tx.refund.create/update`、`tx.order.update/updateMany`、`tx.consumerCreditLedger.create`、`tx.product.*`、`tx.stockLedger.*`、`tx.afterSaleCase.*` 或 `tx.commission.*`；
- `admin-refund-executor.ts` 不直接写 `AfterSaleCase`、`Refund`、`Order`、库存、消费额度或奖励；
- Inventory owner 不再更新 `Refund`；
- Refund、Order、AfterSale、Credit owner 不反向写其他领域；
- 编排层必须调用所有适用 owner。

### 7.2 单元与合同测试

- Refund owner：创建、成功、provider 标识补齐、重复成功、幂等参数冲突；
- Order owner：行锁顺序、部分退款、累计全额退款、版本冲突、超额拒绝；
- AfterSale owner：认领、并发未认领、完成关联、非法状态拒绝；
- Credit owner：全额返还一次、部分退款跳过、非 reward conversion 跳过；
- Inventory owner：回补一次、重复幂等、零剩余跳过，且不写 Refund；
- 编排：Admin、直接 MOCK 和 provider 通知均走相同 owner 边界。

### 7.3 真实 PostgreSQL 集成

必须覆盖：

1. 部分退款只累计金额，不自动回补库存或返还消费额度；
2. 累计达到全额后订单变为 `refunded`，库存只回补一次；
3. 全额退款使用的消费额度只返还一次；
4. 开团服务奖励按商品退款金额正确扣减或取消；
5. 同一退款重复和并发通知不重复产生库存、额度、奖励、时间线或审计副作用；
6. 同订单两笔不同部分退款并发时累计金额不超出实付，超额的一笔被拒绝；
7. 同一售后工单并发执行最多一个成功，另一请求按既有命令语义重放或冲突；
8. 注入库存、额度、奖励、售后日志或审计失败时整笔事务回滚。

### 7.4 发布门禁

- 新增 L50-C3 退款所有权聚焦 verifier；
- API typecheck、全仓 lint/test/build；
- 现有退款命令、库存、奖励、售后、支付和拼团门禁；
- 真实 Admin 浏览器退款链；
- 61 项基线审计与 `verify:all`；
- `community` Runner 保持一次只运行一个重门禁。

## 8. 文件范围

预计新增：

- `apps/api/src/modules/refund/refund-record-service.ts`
- `apps/api/src/modules/refund/refund-record-service.test.ts`
- `apps/api/src/modules/order/order-refund-service.ts`
- `apps/api/src/modules/order/order-refund-service.test.ts`
- `apps/api/src/modules/consumer-credit/order-refund-credit-service.ts`
- `apps/api/src/modules/consumer-credit/order-refund-credit-service.test.ts`
- `apps/api/src/services/refund-domain-ownership.contract.test.ts`
- `apps/api/src/services/refund-domain-ownership.integration.test.ts`
- `scripts/verify-l50-c3-refund-domain-ownership.mjs`

预计修改：

- `apps/api/src/services/refund-service.ts`
- `apps/api/src/modules/refund/admin-refund-executor.ts`
- `apps/api/src/modules/after-sale/after-sale-service.ts`
- `apps/api/src/modules/inventory/inventory-order-service.ts`
- 对应既有单元/集成测试
- `scripts/verify-all-local.sh`
- L50 任务台账中对应 C3 行

明确不修改：

- Admin 和 miniapp 页面；
- Prisma schema、migration、依赖与 lockfile；
- 退款金额和拆分规则；
- 真实微信退款、采购、提现、配送、POS、outbox/inbox。

## 9. 完成条件

只有同时满足以下条件才完成本切片：

1. Admin 和 Refund 编排层不再直接写六个业务领域；
2. 部分/全额退款及 Admin 命令外部行为保持不变；
3. 同订单并发退款按最新余额串行结算，不超退；
4. 库存、消费额度、奖励、时间线和审计不重复；
5. 任一必要后置步骤失败时整个事务回滚；
6. 聚焦测试、真实 PostgreSQL、浏览器、61 项审计和 `verify:all` 全部通过；
7. 台账记录本切片，并保留采购与提现写链作为后续 C3 工作。
