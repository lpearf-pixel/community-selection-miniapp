# L43 开团服务奖励账本增强审计

## 审计结论

1. `CommissionStatus` 当前包含 `estimated`、`frozen`、`pending`、`available`、`withdrawing`、`converted`、`withdrawn`、`deducted`、`cancelled`。
2. `ensureEstimatedCommission` 在支付服务确认支付成功后调用。
3. `markCommissionPendingForCompletedOrder` 已由订单服务在订单完成状态更新时调用。
4. `releaseAvailableCommissions` 仅由旧 verifier 和后台 settle 路由调用，无复杂调度。
5. `syncCommissionAfterRefund` 由退款服务在退款成功后调用。
6. 旧实现只要 paid 且存在 group_buy/leader 即可能生成，缺少 leader 与 group_buy 校验；L43 修复为真实团购且 leader 一致。
7. 旧 release 未校验团购有效状态；L43 release 仅释放 pending 且 T+7 到期的有效记录。
8. 旧退款重算使用 `refund_amount_cents`，会把配送费退款错误计入奖励扣减；L43 改为 `product_refund_amount_cents`。
9. 旧固定奖励按实付分母调整，可能包含配送费；L43 分母固定为原始商品金额。
10. 旧 `RewardLedger` 主要在消费额度转换写出账，available 入账缺失。
11. 旧 Commission 变 available 不写 `RewardLedger`；L43 release 写唯一 `commission_available` 入账。
12. 旧转换可能只有 `convert_credit` out 而没有 available in；L43 提供 backfill。
13. 旧 Admin commissions 接口缺少 active AdminUser、权限和 data scope；L43 加固为 reward 权限与 scope。
14. 旧 Leader 查询允许传任意 `leader_user_id`；L43 要求与当前身份一致。
15. 旧 freeze/unfreeze/settle 缺少权限和审计；L43 加固并复用 release。
16. 历史 Commission 通过 `backfillAvailableRewardLedgers` 幂等补 `commission_available_backfill` 入账兼容。

## 职责划分

`Commission` 保存当前聚合状态、计算基数、预估、扣减、最终金额、T+7 可用时间和人工复核字段。`RewardLedger` 是不可变事件账本，使用幂等键记录 available 入账、退款扣减、转换消费额度扣减和人工复核事件。

## L43 migration follow-up

- `202607130001_l43_reward_ledger_t7_refund_deduct` adds nullable/defaulted L43 fields for `Commission` and `RewardLedger`.
- `202607130002_l43_reward_ledger_t3_refund_deduct` finalizes `RewardLedger.idempotency_key String? @unique` by rewriting only duplicate non-null historical keys to `original_key:legacy:{ledger.id}`, dropping the earlier partial index, and creating the Prisma-compatible nullable unique index `RewardLedger_idempotency_key_key`.
- The duplicate-key migration does not delete RewardLedger rows and does not modify amount, direction, balance, commission, order, or entry-type ledger facts.
