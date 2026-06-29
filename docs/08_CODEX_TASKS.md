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
