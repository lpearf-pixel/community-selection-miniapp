# L50-C3 提现领域所有权治理设计

日期：2026-07-26  
状态：已批准方案 A，待书面规格确认  
基线：`stable/l50-a3-4-business-base@ca6dd163c9118819bfc9e89879630edcafa8d4e4`  
实现分支：`codex/l50-c3-withdrawal-domain-ownership`

## 1. 背景

L50-C3 已完成支付、退款、采购入库等关键写链的领域所有权治理。提现后台的批准、驳回和标记已处理也已具备可靠管理员命令，但提现链仍有两段跨领域写入留在 `apps/api/src/routes/withdrawals.ts`：

1. 团长创建提现申请时，路由直接创建 `Withdrawal`、占用 `Commission`、创建 `WithdrawalCommission`、扣减 `RewardLedger` 并写业务审计。
2. 管理员税务复核时，路由直接更新 `Withdrawal`、upsert `TaxRecord`、写 `AdminAuditLog`、业务事件与订单时间线。

当前团长提现的快速幂等路径只核对 `client_request_id` 与团长身份。同一团长若复用相同 `client_request_id`，但改变佣金集合或声明金额，旧实现仍会返回第一次成功结果。这是风险台账 `GR-FIN-003` 的根因。

税务复核虽然已有 `client_request_id` 和 `expected_updated_at`，但幂等历史存放于 `TaxRecord.payload`，并发控制依赖时间戳；路由同时承担解析、竞争处理、多个领域写入和错误映射，无法形成与其他可靠管理员命令一致的所有权合同。

## 2. 目标

本切片必须同时实现：

- 清除 `GR-FIN-003`：同一 `client_request_id` 只允许原提现命令重放；
- 团长提现按稳定顺序锁定佣金，防止不同申请并发占用同一奖励；
- 拆分 Withdrawal、Commission、RewardLedger、Tax、Audit 五个领域 owner；
- 税务复核改用严格管理员命令、`Withdrawal.version` 和 `AdminCommandReceipt`；
- 创建、税务复核、审核、驳回和标记已处理继续处于同步 PostgreSQL 事务；
- 任一必要写入失败时整笔事务回滚；
- 保持人工审核、人工线下打款和现有页面流程；
- 完成本切片后结束 L50-C3，转入用户购买与拼团上线闭环。

## 3. 非目标

本切片不做：

- 自动打款、银行卡或第三方支付账户绑定；
- 自动报税、税务平台连接或自动开票；
- 提现手续费、分批打款、批量提现或提现撤销；
- 奖励规则、T+7 释放规则、一级团长规则或金额算法变更；
- 新数据库表、Prisma schema、migration、依赖或消息队列；
- Admin 页面布局重做；
- 支付、退款、采购、损耗、盘点、配送、POS 或其他范围外重构。

## 4. 现有外部行为兼容

保留以下接口和第一版规则：

- `POST /api/leaders/me/withdrawals`：团长提交提现；
- `GET /api/leaders/me/withdrawals` 与详情查询；
- `GET /api/leaders/me/withdrawable-commissions`；
- `POST /api/admin/withdrawals/:id/tax-review`；
- `POST /api/admin/withdrawals/:id/approve`；
- `POST /api/admin/withdrawals/:id/reject`；
- `POST /api/admin/withdrawals/:id/mark-paid`；
- 提现必须选择一条或多条完整的可用奖励，金额精确等于奖励合计；
- 提现创建后为 `pending`，税务状态初始为待人工复核；
- 通过、驳回和标记已处理仍由管理员人工操作；
- 标记已处理只记录人工参考号，不触发外部打款；
- 现有成功响应字段、中文提示和权限/数据范围规则保持兼容。

允许的外部变化仅有：

- 同一提现 `client_request_id` 对应不同团长、佣金集合或金额时返回 HTTP 409；
- 税务复核命令使用 `expected_version` 代替 `expected_updated_at`；
- 并发状态变化统一返回 HTTP 409 并提示刷新；
- 严格命令拒绝未知字段。

## 5. 团长提现严格命令

### 5.1 命令结构

新增严格解析后的命令：

```ts
type LeaderWithdrawalCommand = {
  client_request_id: string;
  commission_ids: string[];
  amount_cents?: number;
};
```

规则：

- `client_request_id` trim 后长度为 1–80，trim 前后必须一致；
- `commission_ids` 至少一项，每项为非空字符串；
- 对佣金 ID 去重后按字典序规范化；
- 原始请求含重复佣金 ID 时拒绝，不静默吞掉；
- `amount_cents` 若提供，必须为安全正整数；
- 未声明字段拒绝；
- 命令语义包含团长 ID、排序后的完整佣金集合和最终提现金额；
- `amount_cents` 是可选的一致性断言：省略或提供且等于服务端计算金额视为同一语义，提供不同金额必须拒绝。

### 5.2 幂等重放

继续复用 `Withdrawal.client_request_id` 唯一约束，不新增回执表：

- 找到既有提现后，读取其 `WithdrawalCommission` 关联并按佣金 ID 排序；
- 团长 ID、佣金集合一致，且请求未提供金额或提供金额等于既有提现金额时，返回原提现结果并设置 `idempotent: true`；
- 任一字段不一致时返回 HTTP 409：`client_request_id 已被其他提现命令使用`；
- 唯一键竞争出现 `P2002` 时，重新加载既有提现并执行同一完整比较；
- 重放不再次占用佣金、不再次写奖励账本、不重复写审计；
- 只有已完整提交的 `Withdrawal` 与关联明细可被重放；事务失败不会留下可重放的半成品。

不在 `Withdrawal` 新增请求哈希字段。已持久化的团长 ID、金额和 `WithdrawalCommission` 集合足以恢复原命令语义。

## 6. 税务复核可靠管理员命令

### 6.1 命令结构

```ts
type AdminWithdrawalTaxReviewCommand = {
  idempotency_key: string;
  expected_version: number;
  tax_mode: "none" | "withheld" | "invoice";
  taxable_amount_cents: number;
  tax_amount_cents: number;
  tax_rate_basis?: string;
  invoice_status?: "pending" | "verified" | "rejected";
  tax_remark?: string;
};
```

规则：

- `idempotency_key` 沿用管理员可靠命令的 16–128 可打印 ASCII 规则；
- `expected_version` 必须是非负安全整数，并来自税务详情接口返回的 `Withdrawal.version`；
- 金额均使用整数分，不能为负或超过数据库整数范围；
- 应税金额不能超过提现总额，税额不能超过应税金额；
- `none` 模式税额必须为 0；
- 发票模式自动要求发票，其他模式禁止发票状态；
- 税务状态、发票要求和实际应付金额由服务端确定；
- 请求哈希包含操作名、提现 ID、预期版本和完整规范化税务命令；
- 未声明字段拒绝。

### 6.2 回执语义

复用 `AdminCommandReceipt`，操作名为：

```text
admin.withdrawal.tax-review.v1
```

唯一键继续使用 `(admin_user_id, idempotency_key)`：

- 同一管理员、同一幂等键、请求哈希一致且回执完成：返回首次成功结果；
- 同一幂等键用于其他操作、提现或不同税务内容：HTTP 409；
- 唯一键竞争时重新读取回执；
- 只有 `completed_at`、HTTP 200 和合法响应数据同时存在时允许重放；
- 回执创建、业务写入和回执完成处于同一事务；
- 事务失败时不留下处理中或成功回执。

现有 `TaxRecord.payload.review_requests` 不再承担可靠幂等职责。为兼容历史查询可保留只读字段或继续写最后一次非敏感复核快照，但可靠重放以 `AdminCommandReceipt` 为唯一依据。

## 7. 领域所有权

### 7.1 Withdrawal owner

新增提现领域窄接口，独占：

- `Withdrawal` 创建；
- `WithdrawalCommission` 关联创建与读取；
- `Withdrawal` 行锁、状态和版本转换；
- 提现 DTO 所需的领域快照。

它不写 `Commission`、`RewardLedger`、`TaxRecord`、`AdminAuditLog`、业务事件或命令回执。

建议接口：

```ts
createWithdrawal(tx, input): Promise<WithdrawalSnapshot>;
lockWithdrawal(tx, withdrawalId): Promise<LockedWithdrawal>;
linkWithdrawalCommissions(tx, input): Promise<void>;
transitionWithdrawal(tx, input): Promise<WithdrawalSnapshot>;
```

现有管理员批准、驳回和标记已处理执行器改为调用该 owner，而不是直接更新 `Withdrawal`。

### 7.2 Commission owner

新增提现奖励 owner，独占提现链对 `Commission` 的状态和 `withdrawal_id` 写入：

```ts
lockWithdrawableCommissions(tx, input): Promise<LockedCommission[]>;
claimCommissionsForWithdrawal(tx, input): Promise<void>;
releaseCommissionsFromWithdrawal(tx, input): Promise<void>;
markCommissionsWithdrawn(tx, input): Promise<void>;
```

职责：

- 对规范化后的佣金 ID 按字典序逐行 `SELECT ... FOR UPDATE`；
- 锁后重新读取并校验团长、`available` 状态、`withdrawal_id = null` 和正金额；
- 创建提现时将其原子转换为 `withdrawing`；
- 驳回时恢复为 `available` 并清除 `withdrawal_id`；
- 标记已处理时转换为 `withdrawn`；
- 写入数量不匹配时返回领域冲突，不接受部分成功。

它不创建提现、不写奖励账本、税务、审计或命令回执。

### 7.3 RewardLedger owner

在现有 commission service 的账本能力上建立提现窄接口，独占提现链对 `RewardLedger` 的写入和一致性检查：

```ts
validateWithdrawalRewardBalance(tx, input): Promise<void>;
reserveWithdrawalReward(tx, input): Promise<RewardLedgerSnapshot>;
restoreRejectedWithdrawalReward(tx, input): Promise<RewardLedgerSnapshot>;
recordPaidWithdrawalReward(tx, input): Promise<RewardLedgerSnapshot>;
```

职责：

- 锁定佣金后核对每笔佣金的可用账本净额；
- 核对团长总可用奖励余额；
- 创建提现时写一次 `withdrawal_reserved`；
- 驳回时写一次 `withdrawal_rejected_restore`；
- 标记已处理时写一次不影响可用余额的 `withdrawal_paid`；
- 沿用基于提现 ID 的唯一幂等键；
- 账本不一致时 fail closed，并在事务外按现有方式记录脱敏告警。

它不写 Withdrawal、Commission、Tax、Audit 或命令回执。

### 7.4 Tax owner

新增税务 owner，独占提现链对 `TaxRecord` 的写入和税务字段投影：

```ts
reviewWithdrawalTax(tx, input): Promise<{
  withdrawal_patch: WithdrawalTaxPatch;
  tax_record: TaxRecordSnapshot;
}>;
```

职责：

- 校验税务模式、金额、发票组合和实际应付金额；
- upsert 唯一 `source_type = withdrawal`、`source_id = withdrawal_id` 的 `TaxRecord`；
- 生成允许 Withdrawal owner 应用的明确税务 patch；
- payload 仅保留必要税务快照、人工说明和当前命令的非敏感引用；
- 不直接更新 `Withdrawal`，由 Withdrawal owner 在版本条件下应用 patch；
- 不写审计、业务事件或回执。

### 7.5 Audit owner

复用 `audit-service.ts` 的严格接口，使其独占：

- `AdminAuditLog`；
- `BusinessEventLog`；
- `OrderTimeline`。

提现创建、税务复核、批准、驳回和标记已处理均通过 Audit owner 写入。审计失败时事务回滚，不使用吞错版本。

审计 payload 可包含提现 ID、佣金 ID、订单 ID、金额、版本、税务状态、幂等键和回执 ID；不得包含手机号原文、请求头全量、银行卡、外部支付凭证或未脱敏人工参考号。

## 8. 编排层

新增两个可靠执行器：

1. `leader-withdrawal-executor.ts`：团长创建提现；
2. `admin-withdrawal-tax-review-executor.ts`：管理员税务复核。

既有 `admin-withdrawal-executor.ts` 保留批准、驳回和标记已处理，但改为通过相同 owners 完成领域写入。

路由职责缩减为：

- 身份与权限入口；
- 严格命令解析；
- 调用执行器；
- 把领域错误映射为稳定 HTTP 响应；
- 未知异常记录非敏感诊断并返回通用失败。

路由不得直接调用以下写操作：

- `withdrawal.create/update/updateMany`；
- `withdrawalCommission.create/createMany`；
- `commission.update/updateMany`；
- `rewardLedger.create`；
- `taxRecord.create/update/upsert`；
- `adminAuditLog.create`。

## 9. 创建提现事务数据流

一次新提现按以下顺序执行：

1. 路由验证团长身份并解析严格命令；
2. 执行器按 `client_request_id` 检查既有提现；
3. 若存在，按团长、佣金集合和金额完整比较后重放或返回 409；
4. 开启事务；
5. Commission owner 按佣金 ID 稳定顺序逐行加锁；
6. 锁后重新校验佣金归属、状态、占用和金额；
7. RewardLedger owner 校验每笔佣金与团长总可用余额；
8. Withdrawal owner 创建 `Withdrawal`；
9. Commission owner 占用全部佣金；
10. Withdrawal owner 创建全部 `WithdrawalCommission`；
11. RewardLedger owner 写预留出账；
12. Audit owner 写提现申请事件和订单时间线；
13. 提交事务并返回结果。

第 6–7 步必须在任何业务写入前完成。第 8–12 步任一步失败时，提现、关联、佣金状态、奖励账本和审计全部回滚。

## 10. 税务复核事务数据流

1. 路由验证管理员权限与提现数据范围；
2. 解析严格税务命令并生成请求哈希；
3. 执行器检查可重放的完成回执；
4. 开启事务并创建 `AdminCommandReceipt`；
5. Withdrawal owner `SELECT ... FOR UPDATE` 锁提现；
6. 锁后重新检查数据范围、状态和 `expected_version`；
7. Tax owner校验税务语义并 upsert `TaxRecord`；
8. Withdrawal owner 按当前版本应用税务 patch 并将版本加一；
9. Audit owner 写管理员审计、业务事件和订单时间线；
10. 执行器最后完成回执；
11. 提交事务并返回首次成功结果。

任一步失败时，Withdrawal、TaxRecord、审计、时间线和回执全部回滚。

## 11. 并发与死锁规则

- 同一团长提现命令串行或并发重放：只有一份副作用；
- 同一 `client_request_id` 不同佣金集合或金额：稳定返回 409；
- 不同提现命令竞争同一佣金：按佣金 ID 稳定加锁，最多一个成功；
- 两个多佣金提现交叉选取：锁顺序一致，避免循环等待；
- 锁后发现佣金已占用、状态变化或账本不一致：整笔失败；
- 税务复核与批准/驳回/标记已处理竞争同一提现：提现行锁和版本只允许一个基于原版本提交；
- 同一税务幂等键重放：返回首次成功结果；
- 同一税务幂等键不同命令：返回 409；
- 数据库报告死锁或序列化失败时整笔回滚并返回可重试冲突；服务内不盲目重放财务命令。

## 12. 错误合同

团长提现：

- 缺少或非法字段：HTTP 400；
- 奖励不存在、非本人、不可提现或已占用：HTTP 409；
- 声明金额与奖励合计不一致：HTTP 400；
- `client_request_id` 被不同命令使用：HTTP 409；
- 奖励账本不一致：HTTP 409，`奖励账本待人工复核`；
- 未知错误：HTTP 500，`提交提现申请失败`。

税务复核：

- 严格命令不合法：HTTP 400；
- 无权限或超出数据范围：HTTP 401/403；
- 提现不存在：HTTP 404；
- 幂等键被不同命令使用：HTTP 409；
- 版本或状态已变化：HTTP 409，提示刷新；
- 税务组合或金额不合法：HTTP 400；
- 未知错误：HTTP 500，`提现税务复核失败`。

响应和日志不得泄露手机号原文、人工打款参考号、请求头或潜在外部账户信息。

## 13. 测试与验收

### 13.1 命令测试

- 团长提现：非法/未知字段、重复佣金、规范化顺序、金额和请求签名；
- 税务复核：幂等键、预期版本、金额边界、模式/发票组合、未知字段和请求哈希；
- 同一键相同命令可重放，不同命令冲突。

### 13.2 owner 单元测试

- Withdrawal owner：创建、关联、行锁、版本转换和禁止跨域写入；
- Commission owner：固定锁顺序、锁后校验、全量占用/恢复/完成和计数冲突；
- RewardLedger owner：单佣金净额、总余额、预留、驳回恢复、已处理记录和唯一键；
- Tax owner：组合校验、税务记录 upsert、明确 patch 和 payload 最小化；
- Audit owner：提现链写入只能经严格审计接口。

### 13.3 所有权合同

源码合同必须证明：

- `withdrawals.ts` 不再直接写五个领域表；
- 两个新执行器不直接写 owner 所属表；
- Withdrawal owner 不写 Commission、RewardLedger、Tax、Audit 或回执；
- Commission owner 不写 Withdrawal、RewardLedger、Tax、Audit 或回执；
- RewardLedger owner 不写 Withdrawal、Commission、Tax、Audit 或回执；
- Tax owner 不写 Withdrawal、Commission、RewardLedger、Audit 或回执；
- Audit owner 是审计表唯一写入口；
- 管理员回执只由可靠执行器编排。

### 13.4 真实 PostgreSQL 集成

必须覆盖：

1. 新提现成功后 Withdrawal、关联、Commission、RewardLedger 和审计一致；
2. 同一命令串行重放只产生一份副作用；
3. 同一命令并发重放只产生一份副作用；
4. 同一 `client_request_id` 更换佣金集合返回 409；
5. 同一 `client_request_id` 更换声明金额返回 409；
6. 两个申请竞争同一佣金时只有一个成功；
7. 两个交叉多佣金申请不会部分占用或产生死锁遗留；
8. 佣金账本或总余额不一致时不创建提现；
9. 税务复核成功时 Withdrawal、TaxRecord、审计和回执一致；
10. 税务复核相同命令重放返回首次结果；
11. 税务复核同键不同内容返回 409；
12. 税务复核与批准/驳回并发时只有一个原版本命令成功；
13. 注入 Withdrawal、Commission、RewardLedger、Tax、Audit 或回执完成失败时所有业务表回滚；
14. 驳回恢复奖励和标记已处理沿用现有账本语义。

### 13.5 发布门禁

- 新增 L50-C3 提现所有权聚焦 verifier；
- API 与 Admin 聚焦测试和 typecheck；
- 全仓 lint、test、build；
- 既有提现、佣金、税务和管理员可靠命令验证器；
- 真实 Admin 浏览器提现与税务操作；
- 61 项基线审计与 `verify:all`；
- `community` Runner 一次只运行一个重门禁。

## 14. 预计文件范围

预计新增：

- `apps/api/src/modules/withdrawal/leader-withdrawal-command.ts`
- `apps/api/src/modules/withdrawal/leader-withdrawal-command.test.ts`
- `apps/api/src/modules/withdrawal/leader-withdrawal-executor.ts`
- `apps/api/src/modules/withdrawal/leader-withdrawal-executor.test.ts`
- `apps/api/src/modules/withdrawal/withdrawal-owner.ts`
- `apps/api/src/modules/withdrawal/withdrawal-owner.test.ts`
- `apps/api/src/modules/withdrawal/withdrawal-commission-owner.ts`
- `apps/api/src/modules/withdrawal/withdrawal-commission-owner.test.ts`
- `apps/api/src/modules/withdrawal/withdrawal-reward-ledger-owner.ts`
- `apps/api/src/modules/withdrawal/withdrawal-reward-ledger-owner.test.ts`
- `apps/api/src/modules/withdrawal/admin-withdrawal-tax-review-command.ts`
- `apps/api/src/modules/withdrawal/admin-withdrawal-tax-review-command.test.ts`
- `apps/api/src/modules/withdrawal/admin-withdrawal-tax-review-executor.ts`
- `apps/api/src/modules/withdrawal/admin-withdrawal-tax-review-executor.test.ts`
- `apps/api/src/modules/tax-record/withdrawal-tax-owner.ts`
- `apps/api/src/modules/tax-record/withdrawal-tax-owner.test.ts`
- `apps/api/src/modules/withdrawal/withdrawal-domain-ownership.contract.test.ts`
- `apps/api/src/modules/withdrawal/withdrawal-domain-ownership.integration.test.ts`
- `scripts/verify-l50-c3-withdrawal-domain-ownership.mjs`

预计修改：

- `apps/api/src/routes/withdrawals.ts`
- `apps/api/src/modules/withdrawal/admin-withdrawal-executor.ts`
- `apps/admin` 中税务复核命令构造、类型与相关测试；
- 既有提现、税务、佣金验证器及必要测试；
- `scripts/verify-all-local.sh`；
- 风险台账中 `GR-FIN-003` 的证据与状态；
- L50 台账中已有对应行（仅在确有专用行时）。

明确不修改：

- Prisma schema、migration、依赖和 lockfile；
- miniapp 页面与用户提现交互布局；
- Admin 页面布局；
- 自动打款、支付账户、外部税务或开票接入；
- 奖励比例、T+7、金额算法和提现产品规则；
- 支付、退款、采购、库存、配送、POS 或运维模块。

## 15. 完成条件

只有同时满足以下条件才完成本切片：

1. `GR-FIN-003` 有回归测试，改变佣金集合或金额不能错误重放；
2. 提现创建和税务复核路由不再直接跨领域写表；
3. Withdrawal、Commission、RewardLedger、Tax、Audit owner 边界由合同测试锁定；
4. 佣金按稳定顺序加锁，竞争申请最多一个成功；
5. 税务复核使用 `Withdrawal.version` 与 `AdminCommandReceipt`；
6. 创建、税务复核、审核、驳回、标记已处理均通过统一 owners；
7. 任一必要步骤失败时整笔事务回滚；
8. 现有人工审核和线下处理行为保持兼容；
9. 聚焦测试、真实 PostgreSQL、Admin 浏览器、61 项审计和 `verify:all` 全部通过；
10. L50-C3 标记完成，下一主线转为购买、拼团、支付、成团与失败退款上线闭环。
