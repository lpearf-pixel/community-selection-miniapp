# L42 失败团购人工关闭审计

## 基线

- 稳定基线：stable/l41-business-base
- 稳定 commit：c56f72cdf8fbc283bab694cc410a5415d3d0cf42

## 现有状态与行为

1. 当前 `GroupBuyStatus` 包含：`pending`、`success`、`failed`、`cancelled`、`preparing`、`ready`、`fulfilled`、`closed`。
2. 现有过期失败入口为 `markExpiredGroupBuyFailed`：仅允许 `pending` 且 `end_time` 已过期、有效支付数量未达到 `min_quantity` 时进入 `failed`；若支付数量已达标会刷新为 `success` 并拒绝失败。
3. 已存在 L27 流程函数：`markExpiredGroupBuyFailed`、`closeUnpaidGroupBuyOrders`、`listGroupBuyManualRefundOrders`、`markGroupBuyOrderManualRefunded`。
4. 现有过期扫描只记录 `group_buy_expired_manual_attention_required`，不会自动退款。
5. 现有标记失败不会直接回补库存；但旧的 `markGroupBuyOrderManualRefunded` 会在人工标记全额退款时创建/更新退款并调用 L41 `restoreInventoryForRefund`。
6. 现有 `closeUnpaidGroupBuyOrders` 会把未支付订单 `order_status` 改为 `closed`，同时把 `pay_status` 改为 `closed`，不符合 L42 “pay_status 保持 unpaid”的收口要求。
7. 现有退款成功后的库存回补统一在 `restoreInventoryForRefund` 中按退款单幂等键写入 `StockLedger` 并设置 `Refund.stock_restored`。
8. 未发现除 `group-buy-expiry-service.ts` 外的另一套完整失败关闭流程；L42 应扩展该服务，避免复制平行流程。

## L42 调整策略

- 保留 L27 人工处理主线，扩展为 closure summary、退款确认和最终关闭。
- 标记失败只改变团购状态与审计日志，不自动退款、不自动回补库存、不自动关闭订单。
- 未支付订单关闭只改 `order_status=closed`，保留 `pay_status=unpaid`。
- 已支付订单必须基于真实存在且 `status=success` 的退款单确认，库存回补继续复用 L41 `restoreInventoryForRefund`。
- 最终关闭前统一通过 closure summary 校验阻塞项，满足条件后 `failed -> closed`。
