# L14.5 模块化单体架构说明

## 1. 为什么当前不直接拆微服务

当前系统仍处于社区团购小程序第一版的业务闭环阶段，核心目标是低开销、稳定可跑。订单、库存、采购、批次、奖励、提现、税务复核之间存在强事务一致性要求；如果过早拆成微服务，会引入分布式事务、服务发现、部署编排、链路追踪与故障恢复成本，不符合当前阶段目标。

因此 L14.5 只做模块化单体重构：代码边界清晰，但运行时仍是一个 API 服务和一个数据库。

## 2. 当前采用模块化单体

模块化单体的目标是：

- API URL 保持不变。
- 数据库不拆分。
- 事务仍在同一个 Prisma transaction 内完成。
- 领域逻辑逐步从 route handler 中迁移到 `apps/api/src/modules/**`。
- public routes 与 admin routes 在注册入口上分离，便于后续拆分 public-api / admin-api。

当前新增模块边界包括：

- `modules/order`
- `modules/inventory`
- `modules/purchase`
- `modules/supplier`
- `modules/finance`
- `modules/withdrawal`
- `modules/tax`
- `modules/audit`
- `modules/admin-auth`
- `modules/fulfillment`

## 3. public routes / admin routes 边界

新增路由注册入口：

- `apps/api/src/routes/public/index.ts`
- `apps/api/src/routes/admin/index.ts`

`public` 注册面向小程序与公开兼容流程的路由：

- 商品与分类。
- 团购与订单。
- 支付 MOCK / 微信支付预留。
- 退款。
- 开团服务奖励与提现申请等用户侧能力。

`admin` 注册后台管理路由：

- 后台登录。
- 履约看板和后台订单操作。
- 库存、采购、供应商、批次、损耗、盘点。
- 后台提现、税务、日志与告警。

所有 `/api/admin/**` URL 继续走现有 admin preHandler 鉴权，URL 不变。

## 4. 模块职责

### order

负责订单创建、订单详情、订单状态流转、自提核销等订单生命周期能力。L14.5 已将下单库存锁定的高风险逻辑切到 `inventoryService.lockStockForOrder`，后续继续迁移 `createGroupOrder`、`updateOrderStatus`、`pickupVerify`。

### inventory

负责基础库存单位下的库存扣减、库存调整、采购入库总库存流水、批次损耗、盘点调整等库存一致性逻辑。`Product.stock` 继续表示基础库存单位数量，`Order.quantity` 继续表示销售数量。

### purchase

负责采购计划创建、确认、取消、入库。采购入库必须继续写 `StockLedger(purchase_in)`；若存在 L14 批次能力，必须继续创建 `ProductBatch` 和 `BatchStockLedger(purchase_batch_in)`。

### supplier

负责供应商列表、创建、更新、禁用。供应商禁用只改为 `inactive`，不物理删除。

### finance

承接开团服务奖励相关能力，当前通过 `modules/finance/finance-service.ts` re-export 现有 commission service。规则不变：开团服务奖励只来自开团人自己的真实有效团购订单，退款后按现有逻辑扣回或重算，T+3 可用逻辑不变。

### withdrawal

负责提现申请、审核通过、拒绝、税务复核、人工标记已处理。当前保持人工审核和人工标记，不接真实打款。

### tax

负责税务记录创建、税务复核、税务记录查询。当前只做人工复核和记录，不接外部税务接口，不自动报税。

### audit

统一日志出口：

- `recordBusinessEvent`
- `recordOrderTimeline`
- `recordAdminAudit`
- `recordOpsAlert`

当前 audit module 内部复用既有 logging-service；后续逐步将 route 中直接写 `adminAuditLog` 的位置迁移到该模块。

## 5. 事务边界

### 下单事务

必须在同一 transaction 内完成：

1. 查订单幂等。
2. 查团购。
3. 创建订单。
4. 调用 `inventoryService.lockStockForOrder`。
5. 写库存流水。
6. 写业务事件。
7. 写订单相关日志。

幂等命中时不能重复扣库存，也不能重复写库存流水。

### 采购入库事务

必须在同一 transaction 内完成：

1. 更新 `PurchasePlanItem.received_quantity`。
2. 更新 `Product.stock`。
3. 写 `StockLedger(purchase_in)`。
4. 创建 `ProductBatch`。
5. 写 `BatchStockLedger(purchase_batch_in)`。
6. 更新 `PurchasePlan.status`。
7. 写 `AdminAuditLog`。

### 损耗事务

必须在同一 transaction 内完成：

1. 更新 `ProductBatch.remaining_quantity`。
2. 更新 `Product.stock`。
3. 创建 `InventoryLoss`。
4. 写 `BatchStockLedger(loss_out)`。
5. 写 `StockLedger(loss_out)`。
6. 写 `AdminAuditLog`。

### 提现事务

必须保持：

- `available -> withdrawing`。
- `withdrawing -> withdrawn`。
- `reject -> available`。
- mark-paid 前必须通过税务复核。
- 不得重复扣减或重复释放开团服务奖励。

## 6. 未来拆分路线

当前不拆运行时服务，但保留未来演进路线：

1. `apps/public-api`：小程序公开 API。
2. `apps/admin-api`：后台 API。
3. `apps/finance-worker`：开团服务奖励结算、提现状态推进、税务复核辅助任务。
4. `apps/inventory-service`：库存、批次、损耗、盘点服务。

拆分前提是业务验证稳定、接口边界成熟、数据一致性策略明确。

## 7. 当前不拆数据库的原因

订单、库存、批次、采购、开团服务奖励、提现与税务记录之间存在强一致性要求。当前使用单 PostgreSQL + Prisma transaction 可以保持实现简单和数据一致。拆数据库会引入跨库事务、补偿机制和对账成本，暂不适合第一版。

## 8. 当前不引入 MQ 的原因

当前业务量和复杂度仍可由同步事务支撑。引入 MQ 会增加消息幂等、重试、死信、顺序消费和运维成本。本阶段不引入 Redis、MQ 或异步事件总线。

## 9. 合规边界

模块化重构不改变合规边界：

- 不做多级分销。
- 不做团队收益。
- 不做代理收益。
- 不新增 parent_leader_id / upline_id / downline / team_id / level 字段。
- 开团服务奖励只来自开团人自己的真实有效团购订单。
- 用户可见文案继续统一使用“开团服务奖励”。
- 不接真实打款。
- 不自动报税。
- 不新增优惠券、会员、营销玩法。
