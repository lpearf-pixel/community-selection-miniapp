# 08 Web Codex 阶段任务

Web Codex 开始任务时，请先读取：

1. `AGENTS.md`
2. `docs/00_PROJECT_BRIEF.md`
3. `docs/01_BUSINESS_RULES.md`
4. `docs/02_TECH_ARCHITECTURE.md`
5. `docs/03_DATABASE_SCHEMA.md`
6. `docs/04_API_SPEC.md`
7. `docs/07_COMMISSION_REFUND_RULES.md`
8. 本文件

总原则：不要一次性写完整系统。必须按阶段开发，每阶段完成后运行测试。测试失败不要进入下一阶段。

---

## 阶段 1：初始化项目骨架

目标：创建可运行 monorepo 骨架。

要求：

- pnpm workspace
- apps/api: Node.js + TypeScript + Fastify
- apps/admin: React + Vite + Ant Design
- apps/miniapp: 微信原生小程序目录
- packages/shared
- packages/config
- prisma
- docker-compose.yml
- .env.example
- README.md
- scripts/check.sh

API 必须实现：

```text
GET /health
```

脚本必须有：

```bash
pnpm dev
pnpm build
pnpm lint
pnpm typecheck
pnpm test
```

完成后运行：

```bash
scripts/check.sh
```

---

## 阶段 2：数据库模型和 Seed

目标：实现 Prisma 模型和基础种子数据。

依据：`docs/03_DATABASE_SCHEMA.md`

必须完成：

- Prisma schema
- migration
- seed.ts
- db scripts

根目录脚本：

```bash
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm db:studio
```

Seed 初始化：

- admin 用户
- 5 个商品分类
- 10 个测试商品
- 3 个社区
- 1 个自提点

完成后运行：

```bash
pnpm db:generate
pnpm db:migrate
pnpm db:seed
scripts/check.sh
```

---

## 阶段 3：商品、分类、社区、自提点

目标：实现基础商品浏览和后台商品管理。

API：

```text
GET /api/categories
GET /api/products
GET /api/products/:id
GET /api/communities
GET /api/pickup-stores
```

后台：

- 商品列表
- 新增商品
- 编辑商品
- 上架/下架
- 设置是否支持开团
- 设置开团服务奖励类型和值

小程序：

- 首页
- 商品列表
- 商品详情

测试：

- 商品列表 API
- 商品详情 API
- 商品上下架
- 奖励类型字段

完成后运行：

```bash
scripts/check.sh
```

---

## 阶段 4：团购和订单

目标：实现发起开团、参团、下单、成团和开团失败。

API：

```text
POST /api/group-buys
GET  /api/group-buys
GET  /api/group-buys/:id
POST /api/group-buys/:id/join
POST /api/orders
GET  /api/orders
GET  /api/orders/:id
POST /api/orders/:id/complete
```

规则：

1. 只有 leader 可以发起开团。
2. 普通用户可以参团。
3. 创建订单时状态为 unpaid。
4. 支付成功后订单状态为 paid。
5. 成团统计只统计已支付订单。
6. 达到成团条件后 GroupBuy.status = success。
7. 截止时间到仍未成团，GroupBuy.status = failed。
8. 团失败后 paid 订单进入退款流程，unpaid 订单 closed。
9. 库存必须防止超卖。
10. 创建订单和扣库存必须使用事务。
11. 重复提交订单必须有 client_request_id 幂等。

后台：

- 团购列表
- 团购详情
- 订单列表
- 订单详情
- 标记备货中
- 标记待自提
- 标记已自提/已配送
- 标记完成
- 导出分拣单 CSV

小程序：

- 今日开团页
- 团购详情页
- 发起开团页
- 参团下单页
- 我的订单页

定时任务：

- 每分钟扫描过期未成团团购
- 标记 failed
- 创建待退款记录
- 写入 AuditLog

测试：

- 成功开团
- 参团下单
- 达到人数后成团
- 未达到人数后失败
- 防止超卖
- 重复提交幂等
- 分拣单导出

完成后运行：

```bash
scripts/check.sh
```

---


### 阶段 4 增补：核心可靠性与合规边界

后续复现 L4 时必须同时满足以下增补要求，且不得提前进入 L5-L8：

1. `Order` 必须保存 `quantity Int @default(1)`，库存恢复、成团数量统计必须使用 `order.quantity`，不得用金额反推数量。
2. 下单扣库存必须使用条件更新：`updateMany({ where: { id: product_id, stock: { gte: quantity } }, data: { stock: { decrement: quantity } } })`，且 `count !== 1` 时返回库存不足。
3. 订单支付 MOCK 必须幂等，`unpaid -> paid` 只能成功一次；推荐拆分 `POST /api/orders/:id/mock-pay` 与 `POST /api/orders/:id/status`，保留旧接口时也必须逻辑清晰。
4. 团购 `pending` 与 `success` 状态均允许继续参团，直到 `end_time` 或库存不足；`failed/cancelled/closed` 不允许参团。
5. 过期未成团扫描只处理 `pending` 团：团状态改 `failed`，未支付订单关闭，已支付订单进入待退款，按 `order.quantity` 恢复库存，退款记录必须幂等。
6. L4 不实现微信支付、真实退款、开团服务奖励结算和提现。
7. 不得新增或使用多级关系字段，也不得新增不合规的用户可见宣传文案；用户可见文案只允许“开团服务奖励”。
8. 必须补充并运行 `scripts/verify-l1-l2-l3-l4-local.sh`，覆盖重复下单幂等、支付幂等、成团、库存不足、过期失败、退款待处理和分拣 CSV。

## 阶段 5：微信支付 MOCK 与真实接口结构

目标：实现微信支付接口结构，开发环境可 MOCK。

环境变量：

```env
MOCK_WECHAT_PAY=true
WECHAT_APP_ID=
WECHAT_APP_SECRET=
WECHAT_MCH_ID=
WECHAT_MCH_SERIAL_NO=
WECHAT_API_V3_KEY=
WECHAT_PRIVATE_KEY_PATH=
WECHAT_PAY_NOTIFY_URL=
WECHAT_REFUND_NOTIFY_URL=
```

API：

```text
POST /api/auth/wx-login
POST /api/pay/wechat/prepay
POST /api/pay/wechat/notify
GET  /api/pay/orders/:id/status
POST /api/pay/mock/success
```

规则：

- MOCK 模式 wx-login 返回测试 openid。
- MOCK 模式 prepay 返回 mock requestPayment 参数。
- MOCK 模式可以调用 `/api/pay/mock/success`。
- 生产模式必须读取微信支付环境变量。
- 支付回调必须幂等。
- 支付成功后不能重复生成奖励。

支付成功后：

1. 更新 Payment。
2. 更新 Order 为 paid。
3. 更新团购人数和件数。
4. 检查是否成团。
5. 生成 estimated Commission。

完成后运行：

```bash
scripts/check.sh
```

---


### 阶段 5 增补：支付 MOCK 与微信支付接口结构

L5 只实现支付 MOCK 与真实微信支付接口结构，不进入 L6-L8。后续复现时必须满足：

1. 支付能力必须拆到 `apps/api/src/routes/payments.ts` 与 `apps/api/src/services/payment-service.ts`，不得再把 `/api/orders/:id/complete` 当支付入口。
2. 本地闭环接口为 `POST /api/payments/mock`，重复调用同一 `order_id` 必须复用同一 `Payment`，不得重复累计团购人数和数量。
3. 真实微信 JSAPI 只保留 `POST /api/payments/wechat/jsapi` 结构：MOCK 模式必须提示使用 MOCK 支付；真实模式必须校验微信支付环境变量并返回清晰的预留结构。
4. `POST /api/payments/wechat/notify` 在 MOCK 模式下必须拒绝；真实模式未完成验签、解密、金额校验前不得修改订单。
5. `markOrderPaid(orderId, paymentInfo)` 必须在事务中使用 `updateMany({ id, pay_status: 'unpaid' })` 原子更新，并使用 `order.quantity` 刷新成团统计。
6. L5 不实现真实退款、微信退款、开团服务奖励结算、提现、commission 结算或 withdrawal。
7. 必须补充并运行 `scripts/verify-l1-l2-l3-l4-l5-local.sh`，覆盖 MOCK 支付闭环、重复支付幂等、成团、错误订单、分拣 CSV 和合规扫描。

## 阶段 6：退款系统

目标：实现用户退款、后台审核、MOCK 退款成功、未成团自动退款。

API：

```text
POST /api/refunds
GET  /api/refunds/:id
POST /api/refunds/:id/audit
POST /api/refunds/mock/success
POST /api/refunds/wechat/notify
```

规则：

1. 未支付订单不能退款。
2. 已全额退款订单不能重复退款。
3. 支持部分退款。
4. 总退款金额不能超过订单实付金额。
5. 全额退款后 Order.status = refunded。
6. 部分退款保留当前履约状态。
7. 退款成功后同步扣减 Commission。
8. 未成团失败自动创建退款记录。
9. 回调必须幂等。

后台：

- 退款列表
- 退款审核
- 审核通过
- 审核拒绝
- 查看退款原因

小程序：

- 订单详情申请退款
- 退款进度展示

完成后运行：

```bash
scripts/check.sh
```

---


### 阶段 6 增补：退款 MOCK 与微信退款接口边界

L6 只实现退款申请、审核、MOCK 退款成功与微信退款回调结构，不进入 L7-L8。后续复现时必须满足：

1. 退款接口注册在 `apps/api/src/routes/refunds.ts`，包括 `GET /api/refunds`、`GET /api/refunds/:id`、`POST /api/refunds/mock`、`POST /api/refunds/wechat/apply`、`POST /api/refunds/wechat/notify`。
2. 未支付订单不能退款；累计退款金额不得超过订单实付金额；已全额退款订单不得重复申请。
3. MOCK 退款成功必须幂等：重复处理同一退款单不得重复累加 `Order.refund_amount_cents`。
4. 部分退款不强制改变履约状态；全额退款后订单状态必须为 `refunded`。
5. 微信退款回调在 MOCK 模式下必须拒绝；真实模式未完成验签、解密、金额校验前不得修改订单。
6. L6 不实现微信真实退款、不实现开团服务奖励结算、不实现提现、commission 结算或 withdrawal。
7. 建议运行 `scripts/verify-l1-l2-l3-l4-l5-l6-local.sh` 覆盖部分退款、同一 `client_refund_id` 幂等、超额退款失败、全额退款状态、库存只恢复一次、退款列表和详情。

## 阶段 7：一级开团服务奖励

目标：实现开团人申请、审核、奖励、T+7 可提现和人工提现审核。

API：

```text
POST /api/leaders/apply
GET  /api/leaders/me
GET  /api/leaders/me/groups
GET  /api/leaders/me/commissions
POST /api/leaders/me/withdraw
```

后台：

```text
GET  /api/admin/leader-applications
POST /api/admin/leader-applications/:id/approve
POST /api/admin/leader-applications/:id/reject
GET  /api/admin/commissions
POST /api/admin/commissions/:id/freeze
POST /api/admin/commissions/:id/unfreeze
GET  /api/admin/withdrawals
POST /api/admin/withdrawals/:id/approve
POST /api/admin/withdrawals/:id/reject
POST /api/admin/withdrawals/:id/mark-paid
```

规则：

1. 用户申请成为开团人。
2. 后台审核通过后 role = leader。
3. leader 可以发起团购。
4. 奖励只来自自己发起团购的真实有效订单。
5. 未支付订单不生成奖励。
6. 退款订单扣减奖励。
7. 开团失败奖励取消。
8. 订单完成后 Commission 从 estimated 变 pending。
9. completed_at + 7 天后变 available。
10. 可提现金额来自 available commission。
11. 第一版提现人工审核。

文案禁止出现：

- 下级
- 团队收益
- 二级返佣
- 三级返佣
- 代理收益
- 躺赚
- 拉人头

完成后运行：

```bash
scripts/check.sh
```

---

## 阶段 8：自动验收测试和 CI

目标：补齐自动验收脚本和 GitHub Actions。

需要新增：

```text
scripts/check.sh
scripts/e2e-smoke.sh
scripts/e2e-refund.sh
scripts/e2e-group-failed.sh
.github/workflows/ci.yml
```

CI 执行：

```bash
pnpm install
pnpm db:generate
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

验收脚本详见 `docs/09_ACCEPTANCE_TESTS.md`。

完成后运行全部脚本，并修复错误。

---

## 每阶段完成后必须输出

```text
本阶段完成总结：
1. 完成了哪些功能
2. 修改了哪些文件
3. 执行了哪些测试
4. 测试是否通过
5. 还存在什么问题
6. 下一阶段建议
```

### 阶段 6 增补：退款幂等与库存恢复策略优化

L6 退款系统后续复现时还必须满足：

1. `client_refund_id` 命中已有退款时，必须同时校验 `order_id` 与 `refund_amount_cents`，参数不一致返回“退款幂等键已被使用，且请求参数不一致”。
2. L6 第一版只做金额退款：部分退款不恢复库存；全额退款仅在订单仍处于 `paid/grouped/preparing/ready/refunding` 时自动恢复库存。
3. `picked/delivered/completed` 等已履约订单全额退款不自动恢复库存，审计日志记录 `stock_restore_skipped_reason: order_already_fulfilled`。
4. 微信退款回调成功处理必须校验 `out_refund_no`，并在 `refund_id` 首次出现时写入；已有 `refund_id` 冲突时必须失败。
5. `/api/refunds/wechat/apply` 虽然不发起真实微信退款，也必须复用可退款校验，先拦截未支付、不可退、超额退款等请求。

### 阶段 7 增补：开团服务奖励结算第一版

L7 先实现开团服务奖励结算闭环，不进入自动提现打款：

1. 支付成功后按商品 `commission_type` / `commission_value` 为开团人生成唯一预计奖励，重复支付不重复生成。
2. 订单完成后奖励进入 `pending`，`available_at = completed_at + 7 天`。
3. 结算任务只把到期、未冻结、金额大于 0 的 `pending` 奖励改为 `available`。
4. 部分退款按实际成交金额重算奖励；全额退款取消奖励。
5. 只允许开团人本人发起团购产生的一级开团服务奖励，不新增多级关系字段，不实现提现自动打款。

### 阶段 7 增补：固定金额奖励退款重算

L7 开团服务奖励退款联动必须满足：

1. `percent` 类型按实际成交金额 `base_amount_cents * commission_value / 100` 重算。
2. `fixed` 类型初始预估仍按 `quantity * commission_value`，部分退款后按 `floor((quantity * commission_value) * base_amount_cents / original_pay_amount_cents)` 重算。
3. 全额退款后 `final_amount_cents = 0` 且状态为 `cancelled`。
4. 冻结状态发生退款时状态保持 `frozen`，但金额仍按实际成交金额重算，并在 AuditLog 记录 `was_frozen = true`。

### 阶段 7.5 增补：业务日志、订单时间线、异常告警

L7.5 只补充日志和告警能力，不进入 L8 提现：

1. 新增 `BusinessEventLog`、`OrderTimelineLog`、`OpsAlertLog`，用于记录订单、支付、退款、开团服务奖励的核心业务事件。
2. 日志写入必须走 `sanitizePayload`，手机号、地址和 token/key/cert/private_key/password 等敏感字段不得明文入库。
3. `commission_available` 必须同时写业务事件和订单时间线；可用后退款必须写 warning 事件；已提现后退款必须创建人工处理告警。
4. 后台日志接口提供业务事件、订单时间线、告警列表、告警处理/忽略和订单 AI 分析上下文结构，不调用大模型。

5. 日志表使用弱关联字段，不加 FK，避免历史日志因主业务数据变更受影响；日志写入应优先使用 safe 版本，避免影响主交易。
