# 下一阶段开发计划

当前稳定基线：`stable/l38-business-base`

当前 L38 合并提交：`1d27be8bab675ba3ecd24a48358762cf433a3bc2`

后续开发先从本文件读取任务，不再依赖聊天记录里的旧提示词。

## L39：配送费退款策略 / 部分退款 / 财务导出细化

### Codex 提示词

```text
继续开发 community-selection-miniapp。

当前稳定基线：

stable/l38-business-base

如果 stable/l38-business-base 还没推送，则使用 L38 merge commit：

1d27be8bab675ba3ecd24a48358762cf433a3bc2

请先同步稳定基线并创建 L39 分支：

git fetch origin
git checkout stable/l38-business-base
git pull --ff-only origin stable/l38-business-base
git checkout -b codex/add-l39-delivery-refund-finance-baseline

本阶段：L39 配送费退款策略 / 部分退款 / 财务导出细化

目标：
在 L38 已经把配送费计入订单金额后，补齐配送费在售后、人工退款、财务对账、CSV 导出中的基础策略。

L39 要完成：
1. 明确商品金额、配送费、实付金额、已退金额、可退上限的关系。
2. 售后申请支持区分商品退款金额与配送费退款金额。
3. Admin 人工退款支持录入商品退款金额与配送费退款金额。
4. 退款总额不得超过订单 pay_amount_cents。
5. 财务对账展示商品退款、配送费退款、总退款。
6. CSV 导出增加配送费退款字段并保持公式注入防护。
7. 用户订单详情展示配送费退款状态。
8. 不接真实支付接口。
9. 不接真实退款接口。
10. 不做自动退款。

一、重要边界

允许：
- 允许新增最小 DB 字段，用于记录配送费退款拆分。
- 允许新增 Prisma migration。
- 允许更新售后、退款、财务、用户订单、Admin 页面、安全 mapper。

禁止：
1. 不修改 package.json。
2. 不修改 pnpm-lock.yaml。
3. 不提交 reports/ 到业务 PR。
4. 不写入 token / app secret / app key / .env / .git-credentials。
5. 不接第三方配送真实 API。
6. 不接真实微信支付。
7. 不接真实微信退款。
8. 不做自动退款。
9. 不做自动资金划付。
10. 不做自动税务申报。
11. 不新增奖励结算。
12. 不做完整 RBAC。
13. 不做员工账号管理页面。
14. 不做角色权限管理页面。
15. 不接地图 SDK。
16. 不保存用户定位轨迹。
17. 不暴露完整 receiver_phone。
18. 不暴露 cost_price_cents、commission_value、commission_type、stock_deduct_quantity。
19. 不做开放配送平台。
20. 不对外承接第三方配送业务。
21. 不改变开团服务奖励计算逻辑。

verify/docs/manifest/checklist 不要直接写合规敏感原词；需要表达时用拆词或 HTML comment 拆开。

二、数据库设计

修改：

prisma/schema.prisma

建议在 AfterSaleCase 或 Refund 相关模型增加字段，优先复用已有 Refund/AfterSaleCase 结构。

推荐字段：

product_refund_cents Int @default(0)
delivery_fee_refund_cents Int @default(0)

如项目已有 approved_refund_cents / requested_refund_cents：
- requested_refund_cents 继续表示总申请金额。
- approved_refund_cents 继续表示总审核金额。
- product_refund_cents 表示商品部分退款。
- delivery_fee_refund_cents 表示配送费退款。
- product_refund_cents + delivery_fee_refund_cents 必须等于 approved_refund_cents 或 requested_refund_cents，按具体阶段语义决定。

新增 migration：

prisma/migrations/<timestamp>_l39_delivery_refund_finance/migration.sql

历史数据默认：
- product_refund_cents = requested_refund_cents 或 approved_refund_cents 的商品部分 fallback。
- delivery_fee_refund_cents = 0。

三、售后申请

修改：

apps/api/src/modules/user-orders/user-order-service.ts
apps/api/src/routes/me/orders.ts
apps/miniapp/pages/after-sales/apply/* 或实际售后申请页

用户申请售后时支持：
- requested_product_refund_cents
- requested_delivery_fee_refund_cents
- requested_refund_cents = 两者之和

校验：
- 商品退款不得超过 product_amount_cents 减已退商品金额。
- 配送费退款不得超过 delivery_fee_cents 减已退配送费金额。
- 总退款不得超过 pay_amount_cents 减已退总额。
- pickup_type=store 时配送费退款必须为 0。
- pickup_type=delivery 时可以申请配送费退款，但不自动批准。

四、Admin 人工退款

修改：

apps/api/src/modules/finance/refund-risk-service.ts
apps/api/src/routes/admin/finance.ts
apps/admin/src/pages/finance/* 如存在

Admin 人工退款支持录入：
- product_refund_cents
- delivery_fee_refund_cents
- refund_amount_cents = 两者之和

校验：
- product_refund_cents >= 0。
- delivery_fee_refund_cents >= 0。
- refund_amount_cents <= remaining refundable amount。
- delivery_fee_refund_cents <= remaining delivery fee。
- product_refund_cents <= remaining product amount。
- 不调用真实退款接口。
- 仍然是人工审核 / 人工标记。

五、财务对账

修改：

apps/api/src/modules/finance/finance-report-service.ts
apps/api/src/routes/admin/finance.ts

订单 / 退款 / CSV 增加：
- product_amount_cents
- delivery_fee_cents
- pay_amount_cents
- product_refund_cents
- delivery_fee_refund_cents
- refund_amount_cents
- remaining_refundable_cents

summary 增加：
- total_product_refund_cents
- total_delivery_fee_refund_cents
- total_refund_amount_cents
- total_remaining_refundable_cents

CSV 要继续防公式注入。

六、用户订单详情

修改：

apps/api/src/modules/user-orders/user-order-service.ts
apps/miniapp/pages/orders/detail/index.js

展示：
- 商品金额
- 配送费
- 实付金额
- 商品已退金额
- 配送费已退金额
- 总已退金额
- 剩余可退金额

不展示完整手机号。

七、奖励逻辑检查

非常重要：
- 配送费退款不影响开团服务奖励逻辑，除非既有商品退款已经有扣减逻辑。
- 配送费不得参与开团服务奖励。
- 如果奖励扣减使用 refund_amount_cents，需要确认不会把配送费退款算进商品退款扣减。
- 推荐奖励相关逻辑只使用 product_amount_cents / product_refund_cents。

八、L39 验证脚本

新增：

scripts/verify-l39-delivery-refund-finance-baseline-local.ts

加入：

scripts/verify-all-local.sh
scripts/stage-workflow.ts
scripts/generate-stage-report.ts

L39 chain 应跑：
- L39
- L38
- L37
- L36
- L35
- L34
- L33
- L32
- L31
- L30
- L29
- L28
- L27
- L26
- L25
- L24
- Docker API E2E
- Admin typecheck

L39 verifier 成功输出：

Compliance scan passed.
L39 delivery refund finance baseline verification passed.

九、Docker API E2E 增强

增强 scripts/verify-docker-api-e2e-local.ts：

1. 创建配送规则，base_fee_cents = 500。
2. 创建 pickup_type=delivery 普通订单，确认：
   - product_amount_cents = 商品金额
   - delivery_fee_cents = 500
   - pay_amount_cents = 商品金额 + 500
3. mock 支付使用 pay_amount_cents。
4. 创建售后申请：
   - requested_product_refund_cents = 100
   - requested_delivery_fee_refund_cents = 200
   - requested_refund_cents = 300
5. Admin 人工退款或风险检查能看到拆分字段。
6. 财务 overview 能看到 total_delivery_fee_refund_cents。
7. CSV 导出包含配送费退款字段。
8. pickup_type=store 订单申请配送费退款应失败。

所有 /api/admin/** 请求必须带 admin headers：
- x-admin-role: super_admin
- x-admin-user-id: docker-e2e-admin

十、报告与文档

新增：

docs/reviews/l39-delivery-refund-finance-baseline.md

内容包括：
- 本阶段目标
- 商品退款与配送费退款拆分
- 人工退款边界
- 可退上限
- 财务对账字段
- CSV 导出
- 为什么不接真实支付/退款
- 为什么不做自动退款
- 为什么配送费不参与开团服务奖励
- 后续 L40 可做退款操作台体验优化 / 财务导出筛选 / 对账异常聚合

十一、验证命令

开发完成后执行：

docker compose exec api sh -lc "
cd /app &&
pnpm exec tsx scripts/verify-no-raw-compliance-terms-local.ts
"

docker compose exec api sh -lc "
cd /app &&
pnpm exec tsx scripts/verify-l39-delivery-refund-finance-baseline-local.ts
"

docker compose exec api sh -lc "
cd /app &&
pnpm exec tsx scripts/stage-workflow.ts --stage=L39 --verify
"

docker compose exec api sh -lc "
cd /app &&
pnpm exec tsx scripts/stage-workflow.ts --stage=L39 --verify --scope=chain
"

docker compose exec api sh -lc "
cd /app &&
pnpm --filter @community-selection/admin exec tsc -p tsconfig.json --noEmit --pretty false
"

发布报告：

docker compose exec api sh -lc "
cd /app &&
pnpm exec tsx scripts/stage-workflow.ts --stage=L39 --publish --push
"

十二、提交信息

提交信息：

feat: add L39 delivery refund finance baseline

PR 标题：

feat: add L39 delivery refund finance baseline
```
