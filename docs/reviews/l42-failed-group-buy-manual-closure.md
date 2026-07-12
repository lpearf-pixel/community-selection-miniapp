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

## L42 fixture 修复

- L42 本地 verifier 必须创建真实存在的 active `AdminUser`，所有人工服务调用统一传入该 `admin.id`，避免 `AdminAuditLog.admin_user_id` 外键失败。
- 失败团购人工关闭服务在写业务状态和审计日志前统一校验 active AdminUser；不存在或停用时返回 `管理员不存在或已停用`，不依赖 Prisma 外键错误作为业务校验。
- verifier 覆盖 inactive AdminUser 被拒绝、状态不变、未写审计、未关闭订单、未产生退款确认、库存不变，并校验关键审计 action 均归属真实 admin id。
- Docker E2E 继续复用 `DOCKER_E2E_ADMIN_ID`，在 L42 场景开始前断言该 Admin fixture 存在且 active。

## Docker E2E Admin 鉴权语义修复

- Docker E2E 统一通过 fixture 创建 active `super_admin`、active `operator`、active `store_manager` 与 inactive `super_admin`，避免用不存在的 AdminUser 测试 403 场景。
- Admin 鉴权负向场景按语义区分：无身份 / 缺少 user id / 不存在 AdminUser / inactive AdminUser 返回 401；active 但权限不足返回 403；active 且权限足够但数据范围不匹配返回 403。
- 权限不足改用 active operator 调用缺少权限的售后审核接口；数据范围不足改用 active store_manager 访问不属于其自提点范围的订单和售后。

## L42 响应安全修复

- `confirmFailedGroupBuyRefundHandled` 不再返回完整 Prisma `Order` / `Refund`，统一通过 `toSafeClosureOrder` 与 `toSafeClosureRefund` 输出安全字段。
- L42 安全响应禁止原始 `receiver_phone`、`receiver_address`、`raw_notify`、成本价、密码摘要、奖励配置和库存扣减配置等内部字段；需要展示手机号时仅返回 `receiver_phone_masked`。
- L42 verifier 和 Docker E2E 增加针对 mark-failed、closure-summary、close-unpaid、manual-refund-orders、confirm-refund、repeat confirm-refund、final-close、repeat final-close 响应的显式防泄露断言。

## L42 data scope hardening follow-up

- All L42 Admin group-buy closure routes now use the shared group-buy data-scope helper before calling service functions.
- Confirm-refund additionally validates that the order belongs to the URL group buy and that the AdminUser can access the order community/pickup scope.
- L27 verifier compatibility comments were removed; unpaid closure verification now checks the real rule: `order_status = closed` while `pay_status = unpaid`.
