# L50-C2-T3-B 提现可靠命令设计

- 基线：`stable/l50-a3-4-business-base`
- 分支：`codex/l50-c2-t3b-withdrawal-command`
- 上游：L50-C2-T3-A 退款可靠命令

## 结论

把现有后台提现审核写入收口为三条专用可靠命令：

1. `approve`：`pending -> approved`
2. `reject`：`pending -> rejected`，并且只恢复一次关联的开团服务奖励和可用余额
3. `mark-paid`：`approved -> paid`，仅表示管理员已在线下完成人工打款，关联奖励变为 `withdrawn`

一期继续人工审核、人工打款，不连接微信商户付款或其他自动出款渠道。

## 命令边界

三条命令都只接受：

- `expected_version`：来自提现详情的当前版本
- `idempotency_key`：16–128 个 ASCII 可打印字符，按 Admin 隔离
- `admin_remark`：必填操作说明
- `mark-paid` 额外接受 `manual_reference`，记录线下打款参考号

请求不能提交或修改提现金额、税额、应付金额、Leader、奖励组成或状态。

## 一致性与安全

- 路由要求 `withdrawal.manage`，执行器再次校验当前 Admin 数据域覆盖全部关联订单。
- `Withdrawal.version` 使用乐观锁；状态和版本必须同时匹配。
- 使用 `AdminCommandReceipt(admin_user_id, idempotency_key)` 保存请求哈希和成功响应。
- 提现、关联 Commission、RewardLedger、AdminAuditLog、BusinessEventLog、OrderTimeline 与命令回执在一个 PostgreSQL 事务内提交。
- 相同幂等键和相同请求返回原成功结果；相同键不同请求返回 409。
- 并发同版本命令只允许一个成功，另一个返回 409。
- `mark-paid` 继续要求税务状态完成/已计算；需要发票时必须已核验。

## 保留与排除

保留：

- T+7 可提现规则
- 整笔开团服务奖励提现
- 一级开团服务奖励
- 税务人工复核

排除：

- 自动打款、真实微信/银行卡出款
- 多级奖励
- 退款、库存调整或配送取消
- 修改提现申请创建流程

## 验收

- 命令解析、权限、数据域、版本、幂等和状态机合同通过。
- 真实 PostgreSQL 证明 approve/reject/mark-paid 的并发与回滚。
- Admin 页面使用版本和独立幂等键调用命令。
- 全仓门禁通过后才转 Ready 与合并。
