# Web Codex 自主开发入口

这是给 Web Codex 读取的总控任务。打开本仓库后，请直接执行本文件，不需要用户继续拆分任务。

## 总目标

基于仓库内文档，开发一个稳定可运行、低开销的社区甄选微信小程序系统。

必须完整阅读：

1. `AGENTS.md`
2. `README.md`
3. `docs/00_PROJECT_BRIEF.md`
4. `docs/01_BUSINESS_RULES.md`
5. `docs/02_TECH_ARCHITECTURE.md`
6. `docs/03_DATABASE_SCHEMA.md`
7. `docs/04_API_SPEC.md`
8. `docs/05_MINIAPP_SPEC.md`
9. `docs/06_ADMIN_SPEC.md`
10. `docs/07_COMMISSION_REFUND_RULES.md`
11. `docs/08_CODEX_TASKS.md`
12. `docs/09_ACCEPTANCE_TESTS.md`
13. `docs/10_DEPLOYMENT.md`
14. `docs/12_AUTONOMOUS_DEVELOPMENT_PROMPT.md`
15. `docs/13_STAGE_PROMPTS.md`

## 自主执行规则

请按 `docs/08_CODEX_TASKS.md` 的阶段 1 到阶段 8 顺序开发。

每个阶段必须做到：

1. 先阅读对应文档。
2. 只开发当前阶段需要的功能。
3. 写必要测试。
4. 运行校验命令。
5. 测试失败必须先修复。
6. 通过后再进入下一阶段。
7. 每阶段输出总结。

## 不允许跳过的校验

每阶段至少运行：

```bash
scripts/check.sh
```

如果 `scripts/check.sh` 暂时不可运行，先修复它。

最终阶段还必须补齐并运行：

```bash
scripts/e2e-smoke.sh
scripts/e2e-refund.sh
scripts/e2e-group-failed.sh
```

## 强制合规约束

这是一级开团服务奖励系统，不是多级分销系统。

禁止在代码、数据库、文案、测试中出现多级关系设计，例如：

```text
parent_leader_id
upline_id
team_id
二级返佣
三级返佣
下级收益
团队收益
```

如果业务需要表达奖励，统一使用：

```text
开团服务奖励
```

## 最终交付要求

最终项目必须能完成：

1. 本地启动 API。
2. 本地启动管理后台。
3. 微信原生小程序目录完整。
4. PostgreSQL Docker Compose 可启动。
5. Prisma migration 和 seed 可运行。
6. 商品、团购、订单、支付 MOCK、退款 MOCK、开团服务奖励流程可跑通。
7. 自动验收脚本覆盖主流程、退款流程和过期未成团流程。

## 开始执行

现在从阶段 1 开始，不要询问用户是否继续。阶段通过后自动进入下一阶段。