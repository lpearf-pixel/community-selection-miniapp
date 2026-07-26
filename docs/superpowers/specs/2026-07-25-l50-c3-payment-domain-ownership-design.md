# L50-C3 支付成功链数据所有权治理设计

- 任务：`L50-C3`
- 基线：`stable/l50-a3-4-business-base`
- 开发分支：`codex/l50-c3-payment-domain-ownership`
- 日期：2026-07-25
- 上游：L50-C2 可靠写入命令

## 1. 结论

采用“同步事务编排 + 领域所有者窄接口”方案治理支付成功链。`payment-service` 保留业务事务入口，但不再直接写 `Payment`、`Order` 或 `GroupBuy`；它只负责加载上下文、校验支付场景、按顺序调用 Payment、Inventory、Order、GroupBuy 和 Commission 的领域接口，并在同一个 PostgreSQL 事务内提交。

本切片保持现有普通购买、拼团、MOCK 支付、退款和奖励行为，不接真实微信支付，不引入 outbox/inbox、MQ、微服务或新数据库模型。

## 2. 已核验现状

`apps/api/src/services/payment-service.ts` 当前同时承担：

1. 查询并更新 `Payment` 支付事实；
2. 扣减 `Product.stock` 并创建库存流水；
3. 更新 `Order.pay_status`、`paid_at` 和 `order_status`；
4. 聚合团购已支付数量并更新 `GroupBuy`；
5. 成团后批量把订单改为 `grouped`；
6. 创建支付业务事件、订单时间线、奖励预估和审计。

库存扣减已经委托给 `inventory-order-service`，但 Payment、Order 和 GroupBuy 仍由支付服务直接写入。`refreshGroupBuySuccessState()` 还同时写 `GroupBuy` 与 `Order`，导致成团规则无法独立测试，也让未来支付渠道或 POS 接入必须了解多个领域表。

## 3. 方案比较

### 3.1 方案 A：同步事务内按领域接口编排（采用）

保留模块化单体和单库事务。每个领域只暴露支付成功链需要的最小写接口，支付服务负责编排但不直接操作其他领域模型。改动范围可控，事务语义与现有行为一致。

### 3.2 方案 B：先治理开团创建边界

改动更小，但不能消除支付成功链对订单、库存和团购正确性的核心耦合，对当前“用户可正常购买和拼团”主目标收益较低。

### 3.3 方案 C：全仓跨模块写入一次治理

覆盖退款、售后、采购、库存、奖励和履约的全部直接写入。长期完整，但验证矩阵和回归面过大，不适合作为单个可交付切片。

## 4. 领域所有权与接口

### 4.1 Payment

新增 `apps/api/src/modules/payment/payment-record-service.ts`：

```ts
type PaymentInfo = {
  payment_id?: string;
  out_trade_no?: string;
  transaction_id?: string;
  raw_notify?: Prisma.InputJsonValue;
};

findPaymentForOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
  info: PaymentInfo,
): Promise<Payment | null>;

confirmPaymentRecordPaid(
  tx: Prisma.TransactionClient,
  payment: Payment | null,
  info: PaymentInfo,
): Promise<Payment | null>;
```

该模块只读取或更新 `Payment`。没有支付记录时继续返回 `null`，保持现有 `markOrderPaid()` 兼容行为。

### 4.2 Inventory

继续使用：

```ts
deductInventoryForPaidOrder(tx, {
  order,
  operator_user_id,
}): Promise<InventoryEventResult>;
```

库存模块继续独占 `Product.stock` 与 `StockLedger` 的支付扣减写入。支付服务不得出现 `tx.product.*` 或 `tx.stockLedger.*`。

### 4.3 Order

新增 `apps/api/src/modules/order/order-payment-service.ts`：

```ts
claimOrderPayment(
  tx: Prisma.TransactionClient,
  orderId: string,
  paidAt: Date,
): Promise<{ claimed: boolean; order: Order }>;

setPaidOrderStatus(
  tx: Prisma.TransactionClient,
  orderId: string,
  status: "paid" | "grouped",
): Promise<Order>;

markGroupPaidOrdersGrouped(
  tx: Prisma.TransactionClient,
  groupBuyId: string,
): Promise<number>;
```

`claimOrderPayment()` 使用 `id + pay_status = unpaid` 条件更新，写入 `pay_status = paid` 与 `paid_at`。普通订单随后由 `setPaidOrderStatus(..., "paid")` 推进；拼团订单在团购结果明确后推进为 `paid` 或 `grouped`。成团时只有 Order 模块可批量更新团内订单状态。

订单业务事件和时间线仍在同一事务内生成，但由 Order 模块的公开函数记录，事件类型和用户可见标题保持不变。

### 4.4 GroupBuy

新增 `apps/api/src/modules/group-buy/group-buy-payment-service.ts`：

```ts
type GroupBuyPaymentProgress = {
  group_buy_id: string;
  status: string;
  paid_quantity: number;
  paid_people: number;
  target_count: number;
  is_success: boolean;
  became_success: boolean;
};

refreshGroupBuyAfterPayment(
  tx: Prisma.TransactionClient,
  groupBuyId: string,
  now: Date,
): Promise<GroupBuyPaymentProgress | null>;
```

该接口读取有效已支付订单，只写 `GroupBuy.current_quantity`、`current_people` 和 `status`。它不写订单。团购已成功时返回稳定成功结果；团购非 `pending`、已截止或未达标时不错误升级状态。首次达到目标时 `became_success = true`，业务事件来源改为 `group-buy-payment-service`。

重算前必须用 `SELECT ... FOR UPDATE` 锁定目标 `GroupBuy` 行，再读取有效已支付订单聚合。多个不同订单并发支付同一团时，后获得锁的事务必须在前一事务提交后重算，因此不能出现两笔支付分别只看见自己、最终仍错误停留在 `pending` 的状态。

### 4.5 Commission

继续使用 `ensureEstimatedCommission(orderId, tx)`。它保持奖励领域所有权，只在拼团订单支付成功且规则满足时预估一级开团服务奖励。

## 5. 事务数据流

### 5.1 首次支付

一个 `markOrderPaid()` 事务按以下顺序执行：

1. 读取订单及支付场景所需关联；
2. 由 Payment 模块定位支付记录；
3. 校验订单可支付、团购状态与截止时间；
4. 由 Inventory 模块幂等扣库；
5. 由 Order 模块条件认领订单支付状态；
6. 若条件认领失败，重新读取最新订单并作为并发幂等结果返回；
7. 由 Payment 模块确认支付记录；
8. 普通订单由 Order 模块推进为 `paid`；
9. 拼团订单先由 GroupBuy 模块重算进度，再由 Order 模块把本单推进为 `paid` 或把团内有效已支付订单推进为 `grouped`；
10. 由 Order 模块记录现有支付业务事件和订单时间线；
11. 拼团订单调用 Commission 模块预估奖励；
12. 保留现有支付审计记录；
13. 提交事务。

库存不足、团购不可支付、数据库错误、事件/时间线、奖励或审计任一步失败，全部事务回滚。

### 5.2 重复支付通知

订单已支付时：

- 不重复扣库；
- Payment 模块可补齐支付记录的交易号或原始通知；
- 拼团订单允许重新计算团购进度，以修复上一次并发支付后尚未可见的聚合；
- Order 模块只在团购已成功时幂等确保有效已支付订单为 `grouped`；
- 继续记录现有 `payment_duplicate_ignored` 警告事件；
- 不重复创建奖励。

### 5.3 并发支付

两个请求同时支付同一订单时，库存流水的既有幂等键与 Order 的条件认领共同保证只产生一次有效扣库和一次订单支付推进。未认领到订单的请求读取最新状态并返回，不再写重复时间线、审计或奖励。

不同订单同时使同一团购达标时，GroupBuy 行锁把同一团的进度重算串行化；后获得锁的事务在前一事务提交后按数据库内已支付订单重算绝对进度，因此 `current_quantity`、`current_people` 和 `status` 收敛到真实聚合值。Order 的批量 `grouped` 更新是幂等的。

## 6. 错误与兼容

- `markOrderPaid(orderId, paymentInfo)` 的导出、参数与返回结构保持不变；
- `/api/payments/mock` 的成功 DTO、HTTP 状态和错误文案保持不变；
- `apps/api/src/modules/payment/payment-service.ts` 的兼容导出保持不变；
- `订单不存在`、`订单不可支付`、`当前团购不可支付`、`团购已截止`、`库存不足` 保持原文；
- 不改变数据库 schema、金额、库存扣减、成团门槛或奖励计算规则；
- 业务日志可以把来源从笼统的 `payment-service` 改为实际领域 owner，但事件类型保持不变。

## 7. 测试与验收

### 7.1 源码所有权合同

新增源码合同测试，要求：

- `payment-service.ts` 不包含 `tx.payment.update`、`tx.order.update`、`tx.order.updateMany`、`tx.groupBuy.update`、`tx.product.update` 或 `tx.stockLedger.create`；
- Payment、Order、GroupBuy 各自的支付服务只写本领域模型；
- 支付服务必须调用三个领域接口和既有库存接口。

### 7.2 单元测试

- Payment：按 payment ID、out trade no 和最新订单支付记录定位；确认支付时保留已有 transaction ID；无记录返回 null；
- Order：首次认领、并发未认领、普通订单 `paid`、拼团订单 `grouped`、批量成团幂等；
- GroupBuy：未达标、达到目标、已成功重复刷新、已截止、非 pending 状态和同团并发支付行锁；
- 支付编排：普通购买、拼团未达标、拼团刚达标、重复通知和条件认领失败。

### 7.3 真实 PostgreSQL 集成

必须覆盖：

1. 普通订单支付后只扣一次库存且状态为 `paid`；
2. 拼团未达标时本单为 `paid`，团购进度正确；
3. 最后一单达标后团购为 `success`，有效已支付订单均为 `grouped`；
4. 同一订单并发支付只扣一次库存、只产生一条支付时间线和一份奖励；
5. 两个不同订单并发使同一团达标时，团购必定成功且所有有效已支付订单为 `grouped`；
6. 库存不足时 Payment、Order、GroupBuy、库存流水、奖励和审计均无部分写入；
7. 人为注入后置副作用失败时整个事务回滚。

### 7.4 发布门禁

- 新增 C3 聚焦 verifier；
- API typecheck；
- 现有 L4、L17.5、L26、L30、L41 支付/团购/退款/库存门禁；
- 真实 Admin/miniapp 购买与拼团浏览器链；
- 61 项基线审计与 `verify:all`。

## 8. 文件范围

新增：

- `apps/api/src/modules/payment/payment-record-service.ts`
- `apps/api/src/modules/payment/payment-record-service.test.ts`
- `apps/api/src/modules/order/order-payment-service.ts`
- `apps/api/src/modules/order/order-payment-service.test.ts`
- `apps/api/src/modules/group-buy/group-buy-payment-service.ts`
- `apps/api/src/modules/group-buy/group-buy-payment-service.test.ts`
- `apps/api/src/services/payment-service.test.ts`
- `apps/api/src/services/payment-domain-ownership.contract.test.ts`
- `apps/api/src/services/payment-domain-ownership.integration.test.ts`
- `scripts/verify-l50-c3-payment-domain-ownership.mjs`

修改：

- `apps/api/src/services/payment-service.ts`
- 聚焦 verifier、验证清单和 L50 任务台账

不修改：

- Admin 和 miniapp 页面；
- Prisma schema 和 migration；
- 退款、售后、采购、提现、配送和 POS；
- package manifests、lockfile 和依赖版本。

## 9. 完成条件

只有同时满足以下条件才完成 L50-C3 首切片：

1. 支付服务不再直接写 Payment、Order、GroupBuy 或 Inventory 数据；
2. 普通购买和拼团的现有外部行为不变；
3. 重复与并发支付不产生重复库存、时间线、奖励或审计；
4. 任一后置副作用失败时整个事务回滚；
5. 聚焦测试、真实 PostgreSQL、浏览器链、基线审计和 `verify:all` 全部通过；
6. 任务台账记录本切片结果，并把其余跨模块写链保留为后续 C3 子任务。
