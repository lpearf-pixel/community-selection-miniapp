# 下一阶段开发计划

当前稳定基线：`stable/l44-business-base`
基线 SHA：`3ae666ec0e26383a5b117b64dce30b86a2dee389`
当前候选阶段：L45
当前候选 PR：#52
状态：等待完整 chain、report publish 和人工 review。

说明：L45 候选仍以 `stable/l44-business-base` 为业务基线；在 PR 合并前不得提前记录 `stable/l45-business-base` 或 L45 merge commit。

# 后续阶段开发总计划：L39 到 MVP/上线收口

历史基线说明：L38 merge commit 为 `1d27be8bab675ba3ecd24a48358762cf433a3bc2`；当前稳定基线以上方 L43 信息为准。

本计划用于约束 L39-L50 的后续阶段开发。后续每一阶段都必须只做本阶段范围内的工作，不能提前开发下一阶段；所有阶段都必须保留 L24-L当前阶段 chain regression，并按阶段发布 `reports/Lxx/latest.md` 与 `reports/Lxx/latest-verify-output.txt`，但业务 PR 不提交 `reports/` 目录。

## 全阶段共同约束

- 只允许一级开团服务奖励；奖励只基于真实有效订单。
- 退款订单不计算奖励；部分退款按实际成交商品金额重新计算奖励。
- 未成团自动退款后，开团人无奖励。
- 奖励在订单完成后 T+3 变为可提现。
- 第一版提现走后台人工审核，不做真实自动打款。
- 不做多级<!-- split -->分销，不做团队<!-- split -->收益，不做代理<!-- split -->收益。
- 不新增 `parent_<!-- split -->leader_id`、`up<!-- split -->line_id`、`down<!-- split -->line`、`team_<!-- split -->id`、`le<!-- split -->vel` 等多层级关系字段或语义。
- 不引入优<!-- split -->惠券、会<!-- split -->员、裂<!-- split -->变等非 MVP 能力。
- 禁止启用自动打款开关。
- 禁止启用自动报税开关。
- 金额字段继续统一使用整数分，不使用浮点数存储金额。
- 每个阶段都不修改 `package.json` / `pnpm-lock.yaml`，除非人工单独批准并另开依赖维护 PR。
- 每个阶段都不提交 `reports/`，不写 token / app_secret / app_key / `.env` / `.git-credentials`，不新增与当前阶段无关的 migration，不修改与当前阶段无关的 Prisma schema。

## L39：配送费退款策略 / 部分退款 / 财务导出细化

### 目标

补齐配送费在售后、人工退款、财务对账与导出中的基础策略，明确商品金额、配送费、实付金额、已退金额、可退上限之间的关系。

### 允许范围

- 允许只围绕售后申请、人工退款、财务对账、CSV 导出、用户订单详情做最小改动。
- 允许新增最小 DB 字段或 migration，用于记录商品退款与配送费退款拆分。
- 允许补充本阶段验证脚本与 stage workflow 注册。

### 禁止范围

- 不提前开发 L40 或后续阶段。
- 不接真实支付、真实退款、真实配送平台。
- 不新增开团服务奖励结算能力。
- 不修改 `package.json` / `pnpm-lock.yaml`。
- 不提交 `reports/`。

### 可能涉及文件

- `prisma/schema.prisma`
- `prisma/migrations/**/migration.sql`
- `apps/api/src/modules/user-orders/**`
- `apps/api/src/modules/finance/**`
- `apps/api/src/routes/admin/finance.ts`
- `apps/api/src/routes/me/orders.ts`
- `apps/admin/src/pages/finance/**`
- `apps/miniapp/pages/orders/**`
- `apps/miniapp/pages/after-sales/**`
- `scripts/verify-l39-delivery-refund-finance-baseline-local.ts`

### API 变化

- 售后申请与人工退款 API 可增加商品退款金额、配送费退款金额、总退款金额字段。
- 财务对账 API 可增加商品退款合计、配送费退款合计、剩余可退金额字段。
- 用户订单详情 API 可增加退款拆分展示字段。

### DB 变化

- 可新增商品退款金额与配送费退款金额的整数分字段。
- 如新增字段，必须提供默认值与历史数据兼容策略。

### 验证脚本

- `docker compose exec api sh -lc "cd /app && pnpm exec tsx scripts/verify-l39-delivery-refund-finance-baseline-local.ts"`
- `docker compose exec api sh -lc "cd /app && pnpm exec tsx scripts/verify-no-raw-compliance-terms-local.ts"`
- 保留 L24-L39 chain regression。

### 报告要求

- 必须发布 `reports/L39/latest.md`。
- 必须发布 `reports/L39/latest-verify-output.txt`。
- 不提交 `reports/` 到业务 PR。

### 进入下一阶段条件

- L39 verify 通过。
- L24-L39 chain regression 通过。
- 报告已生成并发布。
- PR 已提交并等待人工 review 与 merge。

## L40：Admin 订单详情增强 / 售后审核工作台

### 目标

增强 Admin 订单详情页与售后审核工作台，让运营可查看订单、售后、退款拆分、配送信息与人工审核记录。

### 允许范围

- 允许增强 Admin 订单详情、售后列表、售后详情、审核动作与只读审计信息。
- 允许补充必要 API 查询字段与验证脚本。

### 禁止范围

- 不提前开发 L41 或后续阶段。
- 不接真实退款接口。
- 不做自动审核。
- 不修改 `package.json` / `pnpm-lock.yaml`。
- 不提交 `reports/`。

### 可能涉及文件

- `apps/api/src/routes/admin/orders.ts`
- `apps/api/src/routes/admin/after-sales.ts`
- `apps/api/src/modules/orders/**`
- `apps/api/src/modules/after-sales/**`
- `apps/admin/src/pages/orders/**`
- `apps/admin/src/pages/after-sales/**`
- `scripts/verify-l40-admin-order-after-sale-workbench-local.ts`

### API 变化

- Admin 订单详情 API 可增加售后摘要、退款拆分、配送摘要、审核记录字段。
- 售后审核 API 可增加人工审核备注与审核结果字段。

### DB 变化

- 默认不新增 DB 字段；如确需记录审核备注，可使用最小字段并提供 migration。

### 验证脚本

- L40 本阶段 verify。
- raw compliance terms verify。
- 保留 L24-L40 chain regression。

### 报告要求

- 必须发布 `reports/L40/latest.md`。
- 必须发布 `reports/L40/latest-verify-output.txt`。
- 不提交 `reports/` 到业务 PR。

### 进入下一阶段条件

- L40 verify 与 L24-L40 chain regression 通过。
- 报告已生成并发布。
- PR 已提交并等待人工 review 与 merge。

## L41：库存扣减与退款库存回补策略

### 目标

明确下单、支付确认、取消、售后退款、未成团退款后的库存扣减与回补策略，避免超卖与重复回补。

### 允许范围

- 允许围绕库存预占、扣减、回补、幂等记录做最小实现。
- 允许增加库存流水或库存事件字段。

### 禁止范围

- 不提前开发 L42 或后续阶段。
- 不引入 MQ、Redis、复杂库存中心。
- 不修改 `package.json` / `pnpm-lock.yaml`。
- 不提交 `reports/`。

### 可能涉及文件

- `prisma/schema.prisma`
- `prisma/migrations/**/migration.sql`
- `apps/api/src/modules/orders/**`
- `apps/api/src/modules/products/**`
- `apps/api/src/modules/refunds/**`
- `scripts/verify-l41-inventory-deduct-restore-local.ts`

### API 变化

- Admin 商品或订单 API 可展示库存扣减与回补摘要。
- 用户下单 API 的错误信息可更明确地提示库存不足。

### DB 变化

- 可新增库存流水表或库存事件字段，金额仍按整数分规则，数量字段使用整数。

### 验证脚本

- L41 本阶段 verify。
- raw compliance terms verify。
- 保留 L24-L41 chain regression。

### 报告要求

- 必须发布 `reports/L41/latest.md`。
- 必须发布 `reports/L41/latest-verify-output.txt`。
- 不提交 `reports/` 到业务 PR。

### 进入下一阶段条件

- L41 verify 与 L24-L41 chain regression 通过。
- 报告已生成并发布。
- PR 已提交并等待人工 review 与 merge。

## L42：团购失败后的人工处理闭环增强

### 目标

增强团购失败后的人工处理闭环，包括失败原因、处理状态、退款确认、用户通知占位与 Admin 跟踪视图。

### 允许范围

- 允许增加团购失败处理状态与人工备注。
- 允许补充 Admin 列表、详情、筛选与导出字段。

### 禁止范围

- 不提前开发 L43 或后续阶段。
- 不接真实消息推送。
- 不做真实自动退款。
- 不修改 `package.json` / `pnpm-lock.yaml`。
- 不提交 `reports/`。

### 可能涉及文件

- `apps/api/src/modules/group-buy/**`
- `apps/api/src/modules/refunds/**`
- `apps/api/src/routes/admin/group-buys.ts`
- `apps/admin/src/pages/group-buys/**`
- `scripts/verify-l42-group-failure-manual-closure-local.ts`

### API 变化

- 团购详情 API 可增加失败处理状态、人工备注、退款确认状态。
- Admin API 可增加批量筛选与处理动作。

### DB 变化

- 可新增团购失败处理状态、人工备注、处理时间字段。

### 验证脚本

- L42 本阶段 verify。
- raw compliance terms verify。
- 保留 L24-L42 chain regression。

### 报告要求

- 必须发布 `reports/L42/latest.md`。
- 必须发布 `reports/L42/latest-verify-output.txt`。
- 不提交 `reports/` 到业务 PR。

### 进入下一阶段条件

- L42 verify 与 L24-L42 chain regression 通过。
- 报告已生成并发布。
- PR 已提交并等待人工 review 与 merge。

## L43：开团服务奖励账本增强 / T+3 可用 / 退款扣减

### 目标

增强开团服务奖励账本，落实订单完成后 T+3 可用、退款扣减、部分退款按实际成交商品金额重算。

### 允许范围

- 允许新增或增强奖励账本状态、可用时间、扣减记录、人工核对字段。
- 允许补充 Admin 与脚本侧校验。

### 禁止范围

- 不提前开发 L44 或后续阶段。
- 不做真实自动打款。
- 不把配送费纳入奖励计算。
- 不新增多级<!-- split -->分销、团队<!-- split -->收益、代理<!-- split -->收益语义。
- 不新增 `parent_<!-- split -->leader_id`、`up<!-- split -->line_id`、`down<!-- split -->line`、`team_<!-- split -->id`、`le<!-- split -->vel` 字段。
- 不修改 `package.json` / `pnpm-lock.yaml`。
- 不提交 `reports/`。

### 可能涉及文件

- `prisma/schema.prisma`
- `prisma/migrations/**/migration.sql`
- `apps/api/src/modules/rewards/**`
- `apps/api/src/routes/admin/rewards.ts`
- `apps/admin/src/pages/rewards/**`
- `scripts/verify-l43-reward-ledger-t3-refund-deduct-local.ts`

### API 变化

- 奖励账本 API 可增加待可用、已可用、已扣减、可提现金额字段。
- Admin API 可增加人工核对字段。

### DB 变化

- 可新增奖励账本状态、可用时间、扣减来源、扣减金额字段。

### 验证脚本

- L43 本阶段 verify。
- raw compliance terms verify。
- 保留 L24-L43 chain regression。

### 报告要求

- 必须发布 `reports/L43/latest.md`。
- 必须发布 `reports/L43/latest-verify-output.txt`。
- 不提交 `reports/` 到业务 PR。

### 进入下一阶段条件

- L43 verify 与 L24-L43 chain regression 通过。
- 报告已生成并发布。
- PR 已提交并等待人工 review 与 merge。

## L44：提现人工审核工作台

### 目标

提供提现人工审核工作台，支持查看可提现奖励、提交提现申请、后台人工审核、人工标记处理结果。

### 允许范围

- 允许新增提现申请、审核状态、审核备注、人工处理记录。
- 允许 Admin 增加提现审核列表与详情。

### 禁止范围

- 不提前开发 L45 或后续阶段。
- 不做真实自动打款。
- 不接银行或第三方打款接口。
- 不修改 `package.json` / `pnpm-lock.yaml`。
- 不提交 `reports/`。

### 可能涉及文件

- `prisma/schema.prisma`
- `prisma/migrations/**/migration.sql`
- `apps/api/src/modules/withdrawals/**`
- `apps/api/src/routes/admin/withdrawals.ts`
- `apps/api/src/routes/me/withdrawals.ts`
- `apps/admin/src/pages/withdrawals/**`
- `apps/miniapp/pages/withdrawals/**`
- `scripts/verify-l44-manual-withdrawal-review-local.ts`

### API 变化

- 用户 API 可增加提现申请与提现记录查询。
- Admin API 可增加提现审核、驳回、人工完成标记。

### DB 变化

- 可新增提现申请表、审核状态、人工处理时间与备注字段。

### 验证脚本

- L44 本阶段 verify。
- raw compliance terms verify。
- 保留 L24-L44 chain regression。

### 报告要求

- 必须发布 `reports/L44/latest.md`。
- 必须发布 `reports/L44/latest-verify-output.txt`。
- 不提交 `reports/` 到业务 PR。

### 进入下一阶段条件

- L44 verify 与 L24-L44 chain regression 通过。
- 报告已生成并发布。
- PR 已提交并等待人工 review 与 merge。

当前阶段：L45（税务人工 Review／内部导出）；L46 尚未开始。

## L45：税务人工 review / 导出占位

### 目标

提供税务人工 review 与导出占位能力，支持后台人工核查提现与奖励数据，生成内部人工处理所需的导出文件。

### 允许范围

- 允许增加税务人工 review 状态、备注、导出字段与内部说明。
- 允许 Admin 提供只读列表、筛选与 CSV 导出。

### 禁止范围

- 不提前开发 L46 或后续阶段。
- 不做自动报税。
- 不接外部税务平台。
- 不修改 `package.json` / `pnpm-lock.yaml`。
- 不提交 `reports/`。

### 可能涉及文件

- `apps/api/src/modules/tax-review/**`
- `apps/api/src/routes/admin/tax-review.ts`
- `apps/admin/src/pages/tax-review/**`
- `scripts/verify-l45-manual-tax-review-export-local.ts`

### API 变化

- Admin API 可增加税务人工 review 列表、详情、导出接口。

### DB 变化

- 默认不新增 DB；如确需记录 review 状态，可新增最小字段或表。

### 验证脚本

- L45 本阶段 verify。
- raw compliance terms verify。
- 保留 L24-L45 chain regression。

### 报告要求

- 必须发布 `reports/L45/latest.md`。
- 必须发布 `reports/L45/latest-verify-output.txt`。
- 不提交 `reports/` 到业务 PR。

### 进入下一阶段条件

- L45 verify 与 L24-L45 chain regression 通过。
- 报告已生成并发布。
- PR 已提交并等待人工 review 与 merge。

## L46：Admin Dashboard V2 / 经营看板收口

### 目标

收口 Admin 经营看板，展示订单、团购、售后、退款、奖励、提现、配送与库存的 MVP 指标。

### 允许范围

- 允许增加看板汇总 API、筛选、趋势、关键指标卡片。
- 允许复用既有数据源，避免新增复杂统计系统。

### 禁止范围

- 不提前开发 L47 或后续阶段。
- 不引入 Elasticsearch、MQ、Redis 或独立数据仓库。
- 不修改 `package.json` / `pnpm-lock.yaml`。
- 不提交 `reports/`。

### 可能涉及文件

- `apps/api/src/modules/dashboard/**`
- `apps/api/src/routes/admin/dashboard.ts`
- `apps/admin/src/pages/dashboard/**`
- `scripts/verify-l46-admin-dashboard-v2-local.ts`

### API 变化

- Admin Dashboard API 可增加 MVP 指标汇总与趋势字段。

### DB 变化

- 默认不新增 DB；优先实时聚合或复用现有表。

### 验证脚本

- L46 本阶段 verify。
- raw compliance terms verify。
- 保留 L24-L46 chain regression。

### 报告要求

- 必须发布 `reports/L46/latest.md`。
- 必须发布 `reports/L46/latest-verify-output.txt`。
- 不提交 `reports/` 到业务 PR。

### 进入下一阶段条件

- L46 verify 与 L24-L46 chain regression 通过。
- 报告已生成并发布。
- PR 已提交并等待人工 review 与 merge。

## L47：小程序个人中心 V2 / 团长中心

### 目标

增强小程序个人中心与团长中心，展示订单、售后、开团、奖励、提现申请入口与必要说明。

### 允许范围

- 允许更新个人中心、团长中心、奖励账本展示、提现申请入口。
- 允许增加必要的用户侧 API 查询字段。

### 禁止范围

- 不提前开发 L48 或后续阶段。
- 不做拉人计酬、排行榜、增长活动。
- 不引入优<!-- split -->惠券、会<!-- split -->员、裂<!-- split -->变能力。
- 不修改 `package.json` / `pnpm-lock.yaml`。
- 不提交 `reports/`。

### 可能涉及文件

- `apps/api/src/routes/me/**`
- `apps/api/src/modules/me/**`
- `apps/miniapp/pages/profile/**`
- `apps/miniapp/pages/leader/**`
- `apps/miniapp/utils/**`
- `scripts/verify-l47-miniapp-profile-leader-center-local.ts`

### API 变化

- 用户侧 API 可增加个人中心汇总、开团摘要、奖励摘要、提现入口状态。

### DB 变化

- 默认不新增 DB；优先读取既有订单、团购、奖励、提现数据。

### 验证脚本

- L47 本阶段 verify。
- raw compliance terms verify。
- 保留 L24-L47 chain regression。

### 报告要求

- 必须发布 `reports/L47/latest.md`。
- 必须发布 `reports/L47/latest-verify-output.txt`。
- 不提交 `reports/` 到业务 PR。

### 进入下一阶段条件

- L47 verify 与 L24-L47 chain regression 通过。
- 报告已生成并发布。
- PR 已提交并等待人工 review 与 merge。

## L48：MVP 安全与隐私收口

### 目标

完成 MVP 安全与隐私收口，检查敏感字段脱敏、导出防护、配置边界、日志安全与文档风险提示。

### 允许范围

- 允许增强日志脱敏、CSV 防公式注入、Admin 字段最小展示、安全验证脚本。
- 允许更新安全与隐私文档。

### 禁止范围

- 不提前开发 L49 或后续阶段。
- 不写入任何密钥、token、app_secret、app_key、`.env`、`.git-credentials`。
- 不修改 `package.json` / `pnpm-lock.yaml`。
- 不提交 `reports/`。

### 可能涉及文件

- `apps/api/src/**/security/**`
- `apps/api/src/**/mappers/**`
- `apps/admin/src/**`
- `apps/miniapp/**`
- `docs/security/**`
- `scripts/verify-l48-mvp-security-privacy-local.ts`

### API 变化

- API 响应可减少或脱敏敏感字段；不得新增敏感明文字段。

### DB 变化

- 默认不新增 DB；如需安全审计占位，必须保持最小范围。

### 验证脚本

- L48 本阶段 verify。
- raw compliance terms verify。
- 保留 L24-L48 chain regression。

### 报告要求

- 必须发布 `reports/L48/latest.md`。
- 必须发布 `reports/L48/latest-verify-output.txt`。
- 不提交 `reports/` 到业务 PR。

### 进入下一阶段条件

- L48 verify 与 L24-L48 chain regression 通过。
- 报告已生成并发布。
- PR 已提交并等待人工 review 与 merge。

## L49：MVP 发布配置 / 环境 / 运维文档收口

### 目标

收口 MVP 发布配置、环境说明、Docker Compose、运维手册、回滚指引与验收清单。

### 允许范围

- 允许更新文档、示例配置说明、部署检查脚本、运维 runbook。
- 允许补充非敏感 `.env.example` 说明。

### 禁止范围

- 不提前开发 L50 或后续阶段。
- 不写真实 token、app_secret、app_key、`.env`、`.git-credentials`。
- 不引入 Kubernetes、微服务或复杂运维平台。
- 不修改 `package.json` / `pnpm-lock.yaml`。
- 不提交 `reports/`。

### 可能涉及文件

- `docs/deployment/**`
- `docs/operations/**`
- `docs/runbooks/**`
- `.env.example`
- `docker-compose.yml`
- `scripts/verify-l49-release-config-ops-docs-local.ts`

### API 变化

- 默认无 API 变化。

### DB 变化

- 默认无 DB 变化，不新增 migration。

### 验证脚本

- L49 本阶段 verify。
- raw compliance terms verify。
- 保留 L24-L49 chain regression。

### 报告要求

- 必须发布 `reports/L49/latest.md`。
- 必须发布 `reports/L49/latest-verify-output.txt`。
- 不提交 `reports/` 到业务 PR。

### 进入下一阶段条件

- L49 verify 与 L24-L49 chain regression 通过。
- 报告已生成并发布。
- PR 已提交并等待人工 review 与 merge。

## L50：MVP 最终验收 / Release Candidate

### 目标

完成 MVP 最终验收，形成 Release Candidate，确认核心链路、合规边界、安全隐私、部署文档与人工运营流程均可交付。

### 允许范围

- 允许更新最终验收脚本、验收文档、RC 清单、已知问题清单。
- 允许修复验收脚本发现的最小文档或配置问题。

### 禁止范围

- 不开发 L50 之后的新业务能力。
- 不接真实自动打款、真实自动报税或非 MVP 平台。
- 不引入优<!-- split -->惠券、会<!-- split -->员、裂<!-- split -->变能力。
- 不修改 `package.json` / `pnpm-lock.yaml`。
- 不提交 `reports/`。

### 可能涉及文件

- `docs/release/**`
- `docs/acceptance/**`
- `scripts/verify-l50-mvp-release-candidate-local.ts`
- `scripts/verify-all-local.sh`
- `scripts/stage-workflow.ts`
- `scripts/generate-stage-report.ts`

### API 变化

- 默认无 API 变化；只允许为验收暴露已有能力的只读检查摘要。

### DB 变化

- 默认无 DB 变化，不新增 migration。

### 验证脚本

- L50 本阶段 verify。
- raw compliance terms verify。
- 保留 L24-L50 chain regression。
- MVP 最终验收脚本。

### 报告要求

- 必须发布 `reports/L50/latest.md`。
- 必须发布 `reports/L50/latest-verify-output.txt`。
- 不提交 `reports/` 到业务 PR。

### 进入下一阶段条件

- L50 verify 与 L24-L50 chain regression 通过。
- MVP Release Candidate 清单完成。
- 报告已生成并发布。
- PR 已提交并等待人工 review 与 merge。

## Codex 执行方式

每次开发下一阶段时，Codex 必须：

1. 读取本计划文档。
2. 找到当前最新 `stable/lxx-business-base`。
3. 基于最新稳定分支创建下一阶段分支。
4. 只执行对应 Lxx 阶段，不能提前开发下一阶段。
5. 完成 verify、chain regression 与 report publish。
6. 确认业务 PR 不提交 `reports/`。
7. 提交 PR。
8. 等人工 review 和 merge。


## 全局：跨阶段 Verifier 兼容规则

- 所有阶段开发必须遵循 `docs/dev/stage-verifier-compatibility.md`。
- 新阶段修改旧模块时，必须审计并运行所有受影响的旧阶段 verifier。
- verifier 检查业务语义，禁止绑定局部变量名、固定排版和魔法数量。
- Docker E2E 的 fixture、查询条件、可搜索字段和预期 ID/数量必须形成显式契约。
- Docker E2E 的所有唯一字段 fixture 必须包含每次运行唯一的 run token，确保失败后可重跑且并发执行不碰撞。
- Docker E2E 必须先等待 `/api/health`，transport 错误必须包含 URL、底层 cause 与容器日志排查命令。
- 持久化 JSON 的幂等判断必须使用规范化后的语义深比较或 canonical serialization，禁止依赖对象键顺序的原始 `JSON.stringify` 比较。
- CSV BOM、文件签名等传输层属性必须检查原始响应字节，禁止用 `Response.text()` 解码后的字符串冒充字节证据。
- API 响应 envelope 或 DTO 字段变化时，必须审计并更新所有旧阶段 E2E、客户端类型和 verifier；分页响应统一通过 `items` 访问记录。
- Mutation API 新增必填幂等键或 `expected_updated_at` 等安全字段时，必须同步更新所有旧阶段调用；禁止为兼容旧测试而降低新接口约束。
