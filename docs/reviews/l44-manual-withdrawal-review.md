# L44 提现人工审核工作台审计与设计

## 旧提现实现审计

1. `Withdrawal` 已有 `leader_user_id`、`amount_cents`、`status`、税务兼容字段、`admin_remark`、`created_at`、`updated_at`。
2. 用户提现接口曾信任 body/query 中的 `leader_user_id` 或 `openid`，存在提交或查询他人提现的身份越权风险。
3. Admin 提现接口曾缺少 active Admin、`withdrawal.view` / `withdrawal.manage` 权限和数据范围校验。
4. 提现申请曾没有 `client_request_id`，不具备客户端请求幂等。
5. 并发申请曾先查后无条件更新 Commission，可能重复占用同一笔开团服务奖励。
6. 提现申请曾只改 Commission/Withdrawal，未写 `withdrawal_reserved`，RewardLedger 可用余额不会减少。
7. 驳回曾恢复 Commission，但未写 `withdrawal_rejected_restore` 恢复 RewardLedger 可用余额。
8. 标记已处理曾没有明确非余额账本，易与申请占用语义混淆。
9. Withdrawal、Commission、RewardLedger 三者可能出现状态不一致。
10. 现有税务字段和 `/tax-review` 是 L45 兼容边界；L44 只补权限门禁，不扩展税率、扣税、导出或税务页面。

## L44 设计

- Leader 身份统一从 `x-openid` 解析，body/query 中的 `leader_user_id` 不覆盖当前身份。
- 提现请求必须携带 `client_request_id` 和整笔 `commission_ids`。
- 创建提现在事务内通过条件 `updateMany` claim Commission。
- 成功申请写 `withdrawal_reserved`，驳回写 `withdrawal_rejected_restore`，人工处理写不影响可用余额的 `withdrawal_paid`。
- 状态机限定 `pending -> approved`、`pending -> rejected`、`approved -> paid`。
- Admin 使用 `withdrawal.view` / `withdrawal.manage`，并通过关联 Commission/Order 校验 data scope。
- 人工处理只记录线下处理凭据，不调用任何真实打款、自动打款或第三方付款。
