# 09 自动验收测试

本文件定义 Web Codex 必须补齐的自动验收脚本。

## 总原则

所有脚本必须可重复运行。测试数据不得污染生产环境。

开发环境默认：

```env
MOCK_WECHAT_PAY=true
NODE_ENV=test
```

## scripts/check.sh

必须执行：

```bash
#!/usr/bin/env bash
set -euo pipefail

pnpm install
pnpm db:generate
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

如果某个命令不存在，Codex 必须先补齐。

## scripts/e2e-smoke.sh

目标：验证完整主流程。

流程：

1. 启动测试数据库。
2. 运行 migration。
3. 运行 seed。
4. 创建测试用户 A。
5. 用户 A 申请成为开团人。
6. 后台审核通过。
7. 用户 A 发起团购。
8. 创建测试用户 B。
9. 用户 B 参团下单。
10. 创建预支付。
11. MOCK 支付成功。
12. 团购达到成团条件。
13. 后台标记订单完成。
14. 生成开团服务奖励。
15. 模拟 T+3。
16. 奖励变为可提现。
17. 用户 A 发起提现申请。
18. 后台审核提现。

必须断言：

- User A role = leader
- GroupBuy.status = success
- Order.pay_status = paid
- Order.order_status 最终为 completed
- Commission.status 最终为 available 或 withdrawn
- Withdrawal.status 正确流转

## scripts/e2e-refund.sh

目标：验证退款和奖励扣减。

流程：

1. 创建 leader。
2. 创建团购。
3. 用户下单。
4. MOCK 支付成功。
5. 生成 estimated Commission。
6. 用户申请部分退款。
7. 后台审核通过。
8. MOCK 退款成功。
9. 检查订单 refund_amount_cents。
10. 检查 Commission 扣减。
11. 再申请全额剩余退款。
12. MOCK 退款成功。
13. 检查 Order.status = refunded。
14. 检查 Commission.status = cancelled 或 final_amount_cents = 0。

必须断言：

- 退款金额不能超过实付金额
- 重复退款被拒绝
- 重复退款回调幂等
- 奖励不会变成负数

## scripts/e2e-group-failed.sh

目标：验证开团失败自动退款。

流程：

1. 创建 leader。
2. 创建团购，min_people 设置为较高值。
3. 用户下单。
4. MOCK 支付成功。
5. 不满足成团条件。
6. 模拟团购过期。
7. 执行过期团购扫描任务。
8. GroupBuy.status = failed。
9. paid 订单创建退款记录。
10. MOCK 退款成功。
11. Order.status = refunded。
12. Commission.status = cancelled。

必须断言：

- 未支付订单被关闭
- 已支付订单进入退款
- 开团人无奖励
- AuditLog 有记录

## 单元测试要求

必须覆盖：

1. 金额计算用分，不用 float。
2. fixed 奖励计算。
3. percent 奖励计算。
4. 部分退款奖励扣减。
5. 全额退款奖励取消。
6. 支付回调幂等。
7. 退款回调幂等。
8. 库存防超卖。
9. client_request_id 幂等。
10. 禁止多级字段扫描。

## 禁止多级字段扫描

测试应扫描 Prisma schema 和源码，确保不出现：

```text
parent_leader_id
upline_id
team_id
下级收益
团队收益
二级返佣
三级返佣
```

如果出现，测试失败。

## GitHub Actions

需要创建：

```text
.github/workflows/ci.yml
```

基本流程：

```yaml
name: CI

on:
  push:
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: community_selection_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install
      - run: pnpm db:generate
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test
      - run: pnpm build
```

Codex 可以根据实际项目结构调整，但必须保留同等验收能力。
