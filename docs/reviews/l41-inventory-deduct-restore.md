# L41 库存扣减与退款回补审计结论

## 基线

- 基线 commit：`7af8cb37b3c0babefe70900b27e3f85ed84caaec`。
- 当前阶段只实现 L41，不提前开发 L42。
- 已读取 `docs/plans/next-stage-development-plan.md` 与 `docs/plans/global-development-requirements.md`，以更严格要求为准。

## 现有模型审计

- `Product` 已有 `stock Int @default(0)` 与 `stock_deduct_quantity Int @default(1)`，金额字段仍为整数分。
- `Order` 已有 `quantity`、`pay_status`、`order_status`、`refund_status`、`product_refund_amount_cents`、`delivery_refund_amount_cents`。
- `Refund` 已有商品/配送费退款拆分与 `stock_restored Boolean @default(false)`。
- `AfterSaleCase` 已有售后申请、审核、处理与退款关联字段。
- `StockLedger` 已有 `source_type`、`source_id`、`direction`、`quantity`、`stock_before`、`stock_after`、`remark`、`payload`、`created_at`，但缺少 L41 要求的唯一 `idempotency_key`、标准化 `event_type`、有符号 `quantity_delta`、以及直接关联 `order_id`、`refund_id`、`after_sale_case_id` 字段。

## 现有库存行为

- 普通订单支付成功后，`markOrderPaid` 会调用 `lockStockForOrder` 扣减库存。
- 团购订单支付成功路径此前没有调用 `lockStockForOrder`，因此团购支付未形成统一扣减闭环。
- `lockStockForOrder` 先读取商品库存、应用层判断后再普通 `update`，存在并发超卖窗口，不满足 L41 原子条件更新要求。
- 下单创建未支付订单时没有发现统一扣减库存逻辑；库存主要发生在普通订单支付成功路径。
- 退款成功时，旧逻辑仅对 `refund.order.group_buy` 且全额退款的部分状态尝试回补库存，普通订单全额退款不统一回补。
- 退款旧逻辑依赖 `Refund.stock_restored` 防重复，但库存流水没有唯一幂等键，无法对同一库存事件做数据库级审计约束。
- 团购失败标记本身在 `group-buy-expiry-service` 中不会直接回补库存；人工退款直接更新订单/退款状态，旧逻辑未复用统一回补服务。

## 批次库存与普通库存

- 系统存在 `ProductBatch`、`BatchStockLedger` 与普通 `Product.stock`、`StockLedger` 双轨库存能力。
- L41 支付扣减与退款回补按 MVP 要求只统一普通商品库存 `Product.stock` 与 `StockLedger`，不新增独立库存中心，不扩展批次扣减策略。

## order.quantity 与 stock_deduct_quantity

- 旧扣减函数使用 `order.quantity * max(1, product.stock_deduct_quantity ?? 1)`。
- L41 继续沿用正整数默认策略：`stock_deduct_quantity` 必须解析为正整数，否则服务层报错，不能静默产生 0 扣减。

## 幂等现状

- 重复支付通过 `order.pay_status === 'paid'` 提前返回，避免重新进入普通订单扣减，但没有库存事件唯一键兜底。
- 重复退款通过 `client_refund_id` / `out_refund_no` 与 `Refund.stock_restored` 部分保证幂等，但库存回补没有统一聚合 remaining restorable 与唯一 idempotency key。

## L41 结论

- 不新增第二套库存表，复用并最小增强 `StockLedger`。
- 库存扣减统一移动到支付成功确认事务内，先原子条件扣减，再标记订单 paid。
- 退款回补统一由 L41 inventory order service 处理，只在成功退款且满足全额商品退款或显式 `restore_quantity` 时回补，配送费退款不影响库存。


## L41 verifier 幂等键修正

- 库存幂等键前缀已结构化为 `inventoryIdempotencyPrefixes`，并通过 `buildInventoryIdempotencyKey(prefix, sourceId)` 统一生成。
- L41 verifier 不再依赖 `refund-success-restore:` / `group-failed-refund-restore:` 这类脆弱源码连续字面量，而是检查结构化前缀、构造函数和运行时 StockLedger 结果。
- 保持既有幂等键格式兼容：`order-paid-deduct:<order_id>`、`refund-success-restore:<refund_id>`、`group-failed-refund-restore:<refund_id>`；`manual_restock` 映射到 `manual-restock:<source_id>`，避免误用普通退款前缀。
