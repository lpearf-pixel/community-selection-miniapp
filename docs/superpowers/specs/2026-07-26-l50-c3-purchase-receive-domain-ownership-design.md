# L50-C3 采购入库数据所有权治理设计

- 任务：`L50-C3`
- 基线：`stable/l50-a3-4-business-base`
- 基线提交：`ffe1d71c297692554af797a0ff3a0d1d2950c893`
- 开发分支：`codex/l50-c3-purchase-receive-domain-ownership`
- 日期：2026-07-26
- 上游：L50-C2 可靠后台命令、L50-C3 支付与退款写入所有权治理

## 1. 结论

采用“同步 PostgreSQL 事务 + 可靠 Admin 命令 + 四个领域 owner”的方案治理采购入库。

`receivePurchasePlan()` 只负责编排，不再直接写采购计划、商品库存、库存流水、商品批次、批次流水或管理员审计。Purchase、Inventory、Batch、Audit owner 在同一事务内分别写本领域；Admin 执行器负责幂等回执、错误映射和事务边界。任何计划投影、库存、批次、流水、审计或回执步骤失败时，整笔入库全部回滚。

本切片同时封住两类并发问题：

1. 同一采购计划的重复或并发入库先锁采购单，再基于最新累计入库数量校验，不能超过计划数量；
2. 不同采购计划给同一商品并发入库时按固定顺序锁商品，保证商品库存与每笔库存流水的前后快照一致。

保持采购数量、成本金额、供应商、生产日期、到货日期、保质期、批次状态和前端操作含义不变。不扩展到采购审批、付款、退货、损耗、盘点、提现、POS 或外部供应商系统。

## 2. 已核验现状

### 2.1 采购服务跨域写入

`apps/api/src/modules/purchase/purchase-service.ts` 的 `receivePurchasePlan()` 当前在一个函数中同时：

1. 读取并校验 `PurchasePlan` 与 `PurchasePlanItem`；
2. 调用库存函数增加 `Product.stock` 并创建 `StockLedger`；
3. 直接增加 `PurchasePlanItem.received_quantity`；
4. 直接创建 `ProductBatch`；
5. 直接创建 `BatchStockLedger`；
6. 直接写批次与采购计划管理员审计；
7. 直接更新 `PurchasePlan.status`。

采购编排因此了解四个领域的表结构，后续任何库存、批次或审计规则变化都会反向修改采购服务。

### 2.2 同采购单并发超收入库

当前代码先普通读取采购计划和明细，再检查：

```text
item.received_quantity + received_quantity <= item.planned_quantity
```

两个并发事务可能同时读到相同的旧 `received_quantity`，均通过校验并分别增加库存、批次和累计入库数量。数据库没有限制累计值不得超过计划值，因此可能超收入库。

### 2.3 跨采购单库存流水失真

`receivePurchaseStock()` 当前先普通读取商品库存，用旧值计算 `stock_after`，随后执行 `stock increment` 并写流水。两个采购计划并发给同一商品入库时，商品最终库存可能因原子增量而正确，但两笔流水可能记录相同的 `stock_before`，其 `stock_after` 不能首尾衔接。

### 2.4 请求没有可靠幂等回执

`POST /api/admin/purchase-plans/:id/receive` 当前没有幂等键。浏览器超时、重复点击或代理重试无法判断首次事务是否已经提交。重复请求只能依赖剩余计划数量偶然拒绝；分批入库场景下，重复请求仍可能被当成新一批合法入库。

### 2.5 生命周期竞争

确认、取消和入库都先读取状态再更新，但没有共享的采购单行锁。取消与入库并发时，两边可能都基于 `confirmed` 状态通过，最终状态由最后一次写入覆盖，造成计划状态与实际库存、批次不一致。

## 3. 方案比较

### 3.1 方案 A：同步事务内拆分 owner，并补齐锁与幂等（采用）

复用现有模块化单体、PostgreSQL 事务和 `AdminCommandReceipt`。Purchase、Inventory、Batch、Audit 各自写本领域，Admin 执行器组织可靠命令。改动集中、可回滚，并与已完成的支付、退款所有权模式一致。

### 3.2 方案 B：只拆 owner

可以降低代码耦合，但重复点击、同采购单超收入库、跨采购单流水失真和取消/入库竞争仍然存在，不满足账实一致性要求。

### 3.3 方案 C：采购、损耗、盘点一起治理

能一次统一全部库存写链，但会同时改变采购、损耗、盘点三个业务状态机，验证矩阵和回归面过大，不适合作为一个可独立验收的 C3 切片。

## 4. 命令合同与兼容

### 4.1 入库命令

新增严格解析器 `admin-purchase-receive-command.ts`。请求体沿用现有字段，并新增必填 `idempotency_key`：

```ts
type AdminPurchaseReceiveCommand = {
  idempotency_key: string;
  remark?: string;
  items: Array<{
    item_id: string;
    received_quantity: number;
    supplier_id?: string;
    production_date?: string;
    arrival_date?: string;
    shelf_life_days?: number;
    remark?: string;
  }>;
};
```

规则：

- `idempotency_key` 为 16–128 个可打印 ASCII 字符，去除首尾空白后必须保持不变；
- `items` 至少一项，`item_id` 在一次命令内不得重复；
- `received_quantity` 必须是安全整数且大于等于 0；
- 日期与保质期沿用现有规则；
- 未声明字段拒绝，避免请求哈希与实际语义不一致；
- 请求哈希包括操作名、采购计划 ID、规范化后的全部明细和备注；
- 明细哈希保持请求顺序，重放必须与原请求逐字段一致。

后台页面在每次用户点击“入库”时生成一个新幂等键；网络层自动重试必须复用同一个命令对象。页面布局、按钮和成功提示不变。

### 4.2 回执语义

复用 `AdminCommandReceipt`，操作名为：

```text
admin.purchase-plan.receive.v1
```

回执唯一键继续使用 `(admin_user_id, idempotency_key)`：

- 同一管理员、同一幂等键、请求哈希一致且回执完成：返回首次成功结果；
- 同一幂等键被其他操作、采购计划或请求内容使用：返回幂等键冲突；
- 唯一键竞争时重新读取回执，只有完整成功回执可以重放；
- 事务失败时回执与全部业务写入一起回滚，不留下“处理中”假成功。

成功响应继续使用现有 `ok(data)` 包装，并保留调用方依赖的采购计划字段和 `items`。失败响应仍使用现有管理端响应外壳；新增的幂等冲突和并发状态冲突使用 HTTP 409，其余现有业务校验中文文案保持不变。

## 5. 领域所有权与窄接口

### 5.1 Purchase owner

新增 `purchase-plan-owner.ts`，只读写 `PurchasePlan` 与 `PurchasePlanItem`：

```ts
lockPurchasePlan(tx, purchasePlanId): Promise<LockedPurchasePlan>;
validatePurchaseReceipt(lockedPlan, command): ValidatedReceiptItems;
applyPurchaseReceipt(tx, input): Promise<PurchasePlan>;
transitionPurchasePlan(tx, input): Promise<PurchasePlan>;
```

职责：

- 使用 `SELECT ... FOR UPDATE` 锁采购计划行；
- 锁成功后重新读取采购明细和最新累计入库数量；
- 一次性校验全部明细后才允许任何领域写入；
- 增加 `PurchasePlanItem.received_quantity`；
- 根据锁后的全部明细把计划状态投影为 `ordered` 或 `received`；
- 确认、取消与入库共用同一采购单锁，避免生命周期竞争。

Purchase owner 不写商品、库存流水、批次、批次流水、审计或命令回执。

### 5.2 Inventory owner

从现有库存服务抽出采购入库窄接口：

```ts
receivePurchaseInventory(tx, input): Promise<{
  product_id: string;
  stock_before: number;
  stock_after: number;
  stock_unit: string;
  stock_ledger_id: string;
}>;
```

职责：

- 使用 `SELECT ... FOR UPDATE` 锁商品行后读取最新库存；
- 增加 `Product.stock`；
- 创建一笔 `StockLedger`；
- 写入唯一幂等键 `purchase-receive:<receipt_id>:<item_id>`；
- 保持 `source_type = purchase_in`、`source_id = purchase_plan_id` 和现有 payload 字段，兼容历史查询与报表。

Inventory owner 不写采购计划、采购明细、商品批次、批次流水、审计或命令回执。

同一命令涉及多个商品时，编排层按 `product_id`、`item_id` 的稳定顺序调用 Inventory owner。不同事务因此以相同顺序获取商品锁，降低交叉商品入库死锁风险。同一计划中同一商品出现多项时，仍按明细分别生成库存流水和批次。

### 5.3 Batch owner

新增 `purchase-batch-owner.ts`，只写 `ProductBatch` 与 `BatchStockLedger`：

```ts
createPurchaseBatch(tx, input): Promise<{
  batch_id: string;
  batch_no: string;
  batch_ledger_id: string;
}>;
```

职责：

- 读取已验证的供应商快照；
- 创建一个与本次正数入库明细对应的 `ProductBatch`；
- 创建对应的 `BatchStockLedger`；
- 使用 Inventory owner 返回的商品库存前后值；
- 保持采购计划、采购明细、成本、日期、效期、单位与备注快照不变。

零数量明细继续不创建库存或批次副作用。Batch owner 不写商品库存、通用库存流水、采购累计数量、审计或命令回执。

### 5.4 Audit owner

复用 `audit-service.ts` 的严格 `recordAdminAudit()`，由它独占 `AdminAuditLog` 写入：

- 每个成功创建的批次写 `purchase_batch_created`；
- 整个采购计划入库完成后写一次 `purchase_plan_received`；
- payload 只写幂等键、回执 ID、明细增量、批次 ID 和库存流水 ID，不写供应商联系方式、地址、证照内容或请求头；
- 审计写入失败时整个事务回滚，不吞掉异常。

本切片不新增独立审计表，不把 `AdminAuditLog` 写入复制到 Purchase、Inventory 或 Batch owner。

### 5.5 Admin 执行器与采购编排层

新增 `admin-purchase-receive-executor.ts`：

- 创建、完成和重放 `AdminCommandReceipt`；
- 开启唯一同步事务；
- 调用 Purchase、Inventory、Batch、Audit owner；
- 把领域错误映射为稳定 HTTP 状态和中文文案；
- 不直接写任何四个业务领域表。

`purchase-service.ts` 保留创建、确认、取消和入库的公开函数。入库函数只委托可靠执行器；创建、确认、取消逐步改用 Purchase owner 与 Audit owner，但不改变公开签名和现有行为。

## 6. 事务数据流

一次采购入库按以下顺序执行：

1. 路由验证管理员身份并解析严格命令；
2. 执行器先检查是否存在可重放的完成回执；
3. 开启事务并创建 `AdminCommandReceipt`；
4. Purchase owner 锁采购计划行；
5. Purchase owner 重新读取计划与明细，校验状态、重复 item、累计数量和全部输入；
6. Batch owner 校验并读取所需供应商快照；
7. 编排层将正数明细按 `product_id`、`item_id` 稳定排序；
8. 每项依次由 Inventory owner 锁商品、增加库存并写通用库存流水；
9. Batch owner创建商品批次和批次流水；
10. Purchase owner增加各明细累计入库数量并投影计划状态；
11. Audit owner写每批次审计及采购计划入库审计；
12. 执行器写入完整成功回执；
13. 提交事务并返回更新后的采购计划。

第 5 步必须在任何库存或批次写入前验证完整命令，避免“前半明细已处理、后半明细才发现非法”的隐式依赖。第 8–12 步任一步失败，采购累计数量、计划状态、商品库存、两类流水、批次、审计和回执全部回滚。

确认与取消只使用 Purchase owner 的采购单锁和 Audit owner；它们不能与入库同时基于旧状态提交。

## 7. 并发、重放与死锁处理

- 同一幂等键重复提交：只产生一份计划、库存、批次、流水和审计副作用；
- 同一幂等键不同请求：拒绝并返回冲突，不复用旧结果；
- 同计划不同幂等键并发：采购单行锁串行化，后一事务按最新累计数量重新校验；
- 同一明细并发超收：最多一个事务可使累计数量达到上限，另一事务被拒绝；
- 同计划合法分批入库：每一批使用独立幂等键，累计数量与状态正确推进；
- 不同计划给同一商品并发入库：商品行锁串行化，库存流水前后值首尾一致；
- 多商品交叉入库：按稳定顺序获取商品锁；若 PostgreSQL 仍报告死锁，整个事务回滚并返回可重试失败，不在服务内盲目自动重放管理员命令；
- 取消与入库并发：采购单锁后重新校验状态，只能有一个状态转换路径成功。

## 8. 错误与外部行为

- 采购计划不存在：保持“采购计划不存在”；
- 非 `confirmed`/`ordered` 状态入库：保持“仅已确认或已下单采购计划可入库”；
- 明细不存在、供应商不存在、日期或保质期非法：保持现有中文文案；
- 累计数量超过计划：保持“累计入库数量不能超过计划数量”；
- 幂等键复用：HTTP 409，“幂等键已被其他命令使用”；
- 生命周期或累计数量并发冲突：HTTP 409，提示刷新采购计划后重试；
- 未知数据库或审计错误：HTTP 500，“采购入库失败”，服务端日志不输出请求中的敏感内容；
- 不改变采购计划创建、列表、确认、取消接口路径；
- 不改变商品库存单位、采购单位换算、成本计算或批次效期规则；
- 不新增 Prisma schema、migration、依赖、消息队列或异步最终一致性。

## 9. 测试与验收

### 9.1 命令与所有权合同

- 命令解析覆盖缺失/非法幂等键、未知字段、重复 item、数量、日期和保质期；
- 请求哈希覆盖采购计划 ID 与完整规范化命令；
- `purchase-service.ts` 和 Admin 执行器不直接写 Product、StockLedger、ProductBatch、BatchStockLedger 或 AdminAuditLog；
- Purchase owner 不反向写 Inventory、Batch、Audit 或回执；
- Inventory owner 不反向写 Purchase、Batch、Audit 或回执；
- Batch owner 不反向写 Purchase、Inventory、Audit 或回执；
- Audit owner 是 `AdminAuditLog` 唯一写入口。

### 9.2 单元测试

- Purchase owner：行锁先于读取、全部输入先验证、部分入库、全量入库、超收、非法状态、确认/取消竞争；
- Inventory owner：商品行锁、库存增加、流水前后值、唯一幂等键和原有 payload；
- Batch owner：供应商快照、日期/效期、批次与批次流水、零数量跳过；
- 执行器：完成回执重放、幂等键冲突、唯一键竞争、错误映射和成功结果校验；
- Admin 客户端：每次用户动作创建一次幂等键，网络调用传递同一命令对象；
- 原有 L13、L14 采购与批次行为继续通过。

### 9.3 真实 PostgreSQL 集成

必须覆盖：

1. 合法部分入库后计划为 `ordered`，库存、批次和两类流水各增加一次；
2. 后续分批入库达到计划数量后状态为 `received`；
3. 同一命令串行及并发重放只产生一份副作用；
4. 同计划两个不同命令并发不会使累计入库超过计划数量；
5. 不同采购计划并发给同一商品入库时，最终库存正确且两笔流水前后值连续；
6. 两个交叉商品采购计划并发完成，不死锁且流水正确；
7. 取消与入库并发时计划状态和实际库存保持一致；
8. 注入 Purchase、Inventory、Batch、BatchLedger、Audit 或回执完成失败时，全部表恢复到事务前数量与金额。

### 9.4 发布门禁

- 新增 L50-C3 采购入库所有权聚焦 verifier；
- API 与 Admin typecheck、全仓 lint/test/build；
- L13 采购库存、L14 供应商批次和现有 L50 库存调整门禁；
- 真实 Admin 浏览器采购入库链；
- 61 项基线审计与 `verify:all`；
- `community` Runner 保持一次只运行一个重门禁。

## 10. 文件范围

预计新增：

- `apps/api/src/modules/purchase/admin-purchase-receive-command.ts`
- `apps/api/src/modules/purchase/admin-purchase-receive-command.test.ts`
- `apps/api/src/modules/purchase/admin-purchase-receive-executor.ts`
- `apps/api/src/modules/purchase/admin-purchase-receive-executor.test.ts`
- `apps/api/src/modules/purchase/purchase-plan-owner.ts`
- `apps/api/src/modules/purchase/purchase-plan-owner.test.ts`
- `apps/api/src/modules/inventory/purchase-inventory-owner.ts`
- `apps/api/src/modules/inventory/purchase-inventory-owner.test.ts`
- `apps/api/src/modules/inventory/purchase-batch-owner.ts`
- `apps/api/src/modules/inventory/purchase-batch-owner.test.ts`
- `apps/api/src/modules/purchase/purchase-domain-ownership.contract.test.ts`
- `apps/api/src/modules/purchase/purchase-domain-ownership.integration.test.ts`
- `scripts/verify-l50-c3-purchase-receive-domain-ownership.mjs`

预计修改：

- `apps/api/src/modules/purchase/purchase-service.ts`
- `apps/api/src/modules/inventory/inventory-service.ts`
- `apps/api/src/routes/inventory.ts`
- `apps/admin/src/features/supply/purchase-plans/api.ts`
- `apps/admin/src/features/supply/purchase-plans/api.test.ts`
- `apps/admin/src/features/supply/purchase-plans/PurchasePlansPage.tsx`
- `apps/admin/src/features/inventory/shared/types.ts`
- L13/L14 采购验收脚本与相关既有测试
- `scripts/verify-all-local.sh`
- L50 任务台账中对应 C3 行（仅在已有专用行时）

明确不修改：

- Prisma schema、migration、依赖与 lockfile；
- Admin 页面布局与 miniapp；
- 采购成本、数量换算、供应商及效期规则；
- 损耗、盘点、退款、提现、配送、POS；
- 外部供应商、支付、MQ、outbox/inbox 或微服务。

## 11. 完成条件

只有同时满足以下条件才完成本切片：

1. 采购入库编排层不再直接写 Purchase、Inventory、Batch、Audit 四个领域；
2. 同一命令重复或并发提交只产生一份副作用并能重放原结果；
3. 同计划并发入库不能超过计划数量，确认、取消和入库不能基于旧状态同时成功；
4. 跨计划同商品并发入库的库存与流水前后值一致；
5. 批次、库存、两类流水、计划累计数量、审计和回执处于同一事务；
6. 任一必要步骤失败时整笔入库回滚；
7. 现有采购与批次外部行为保持兼容；
8. 聚焦测试、真实 PostgreSQL、Admin 浏览器、61 项审计和 `verify:all` 全部通过；
9. 台账记录采购入库切片，并保留提现写链作为后续 C3 工作。
