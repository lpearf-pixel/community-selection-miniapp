# 12 Web Codex 自主开发总提示词

本文件用于让 Web Codex 自主读取仓库文档、开发、测试和验证。

## 执行身份

你是本仓库的全栈开发工程师。你的任务是把当前仓库开发成一个稳定可运行、低开销的社区甄选微信小程序项目。

请自行阅读文档、拆分任务、写代码、写测试、运行校验、修复错误，并按阶段继续开发。

## 必读文件

开始前必须阅读：

- AGENTS.md
- README.md
- CODEX_TASK.md
- docs/00_PROJECT_BRIEF.md
- docs/01_BUSINESS_RULES.md
- docs/02_TECH_ARCHITECTURE.md
- docs/03_DATABASE_SCHEMA.md
- docs/04_API_SPEC.md
- docs/05_MINIAPP_SPEC.md
- docs/06_ADMIN_SPEC.md
- docs/07_COMMISSION_REFUND_RULES.md
- docs/08_CODEX_TASKS.md
- docs/09_ACCEPTANCE_TESTS.md
- docs/10_DEPLOYMENT.md
- docs/13_STAGE_PROMPTS.md

## 开发阶段

必须按 docs/08_CODEX_TASKS.md 的 8 个阶段顺序推进：

1. 初始化项目骨架
2. 数据库模型和 Seed
3. 商品、分类、社区、自提点
4. 团购和订单
5. 微信支付 MOCK 与接口结构
6. 退款系统
7. 一级开团服务奖励
8. 自动验收测试和 CI

## 每阶段固定流程

每个阶段都必须执行：

1. 阅读阶段要求。
2. 检查现有代码。
3. 只实现当前阶段需要的最小可运行功能。
4. 增加必要测试。
5. 运行 scripts/check.sh。
6. 如果失败，先修复失败。
7. 通过后输出阶段总结。
8. 继续下一阶段。

## 校验命令

每阶段至少运行：

```bash
scripts/check.sh
```

最终阶段还要补齐并运行：

```bash
scripts/e2e-smoke.sh
scripts/e2e-refund.sh
scripts/e2e-group-failed.sh
```

如果脚本不可运行，先修复脚本和项目配置。

## 关键业务约束

1. 金额统一用整数分存储和计算。
2. API 必须使用统一响应格式。
3. 支付和退款必须支持 MOCK 模式。
4. 订单、支付、退款回调必须幂等。
5. 下单和扣库存必须使用事务。
6. 必须防止超卖。
7. 必须支持开团失败后的自动退款流程。
8. 必须支持一级开团服务奖励。
9. 第一版提现只做后台人工审核。

## 合规约束

本系统只允许一级开团服务奖励。奖励只来自开团人本人发起团购产生的真实有效订单。

禁止设计多层级奖励关系。数据库和代码中不要出现上级、团队、层级类关系字段。

所有用户可见文案统一使用“开团服务奖励”。

## 阶段总结格式

每阶段完成后输出：

```text
阶段 X 完成总结
完成内容：...
修改文件：...
测试执行：...
测试结果：...
已知问题：...
下一阶段：...
```

## 自主继续规则

阶段测试通过后，继续下一阶段，不需要等待用户确认。

遇到不可完成项时，先实现可运行替代方案，并在总结中明确说明。