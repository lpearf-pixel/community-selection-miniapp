# Codex 阶段执行索引

Web Codex 请按本文件顺序执行，并参考 docs/08_CODEX_TASKS.md 的详细要求。

## 通用要求

每阶段都要：

1. 读取 AGENTS.md、CODEX_TASK.md 和 docs 目录文档。
2. 只做当前阶段。
3. 写必要测试。
4. 运行 scripts/check.sh。
5. 校验不通过就先修复。
6. 通过后继续下一阶段。

## 阶段 1：项目骨架

创建 pnpm workspace 项目。

需要包含：

- apps/api：Fastify + TypeScript，提供 GET /health
- apps/admin：React + Vite + Ant Design
- apps/miniapp：微信原生小程序目录
- packages/shared
- packages/config
- prisma
- scripts
- docker-compose.yml
- .env.example
- package.json
- pnpm-workspace.yaml
- tsconfig.base.json

补齐 dev、build、lint、typecheck、test 脚本。

## 阶段 2：数据库

根据 docs/03_DATABASE_SCHEMA.md 实现 Prisma 模型。

需要包含用户、商品、社区、自提点、团购、订单、支付、退款、奖励、开团人申请、提现、审计日志。

金额统一用整数分。

补齐 migration、seed 和 db 脚本。

## 阶段 3：商品基础功能

实现商品、分类、社区、自提点接口。

实现后台商品管理。

实现小程序首页、商品列表、商品详情。

## 阶段 4：团购和订单

实现发起团购、参与团购、创建订单、订单查询、订单完成、分拣单导出。

订单创建和库存扣减必须使用事务。

必须支持请求幂等和库存防超卖。

## 阶段 5：支付 MOCK

实现微信登录、预支付、支付通知、支付状态查询、MOCK 支付成功。

支付通知必须幂等。

支付成功后更新订单、团购统计，并生成开团服务奖励。

## 阶段 6：退款

实现退款申请、退款审核、MOCK 退款成功、退款通知。

支持部分退款和全额退款。

退款成功后扣减开团服务奖励。

过期未成团要自动创建退款记录。

## 阶段 7：开团服务奖励

实现开团人申请、后台审核、我的开团、我的奖励、提现申请、提现审核。

奖励只来自开团人本人发起团购产生的真实有效订单。

订单完成后进入待结算，完成后第 7 天变为可提现。

第一版提现后台人工审核。

## 阶段 8：自动验收

补齐自动验收脚本：

- scripts/check.sh
- scripts/e2e-smoke.sh
- scripts/e2e-refund.sh
- scripts/e2e-group-expired.sh

覆盖主流程、退款流程和过期未成团流程。

最终所有脚本通过后输出项目总结。
