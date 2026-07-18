# L47 小程序个人中心 V2 与团长中心 Review 说明

## 1. 阶段范围

L47 只交付两个只读中心：

- 所有已认证用户可访问的个人中心；
- 仅 `leader` 角色可访问的团长中心。

本阶段不实现 L48，不新增优惠券、会员、裂变、排行榜、拉人计酬、多级分销、团队收益、自动打款或自动报税。

## 2. API

### `GET /api/me/center-summary`

认证方式复用现有用户身份解析：

- 优先读取 `x-user-id`；
- 其次读取 `x-openid`；
- 缺少身份返回 HTTP 401；
- 用户不存在返回 HTTP 404。

返回内容：

- `profile`：`user_id`、昵称、头像、用户侧角色；
- `orders`：全部、待支付、待履约、待自提、配送中、已完成数量；
- `after_sales.pending_count`：待处理售后数量；
- `navigation.leader_center_available`：是否展示团长中心入口；
- `updated_at`。

### `GET /api/leaders/me/center-summary`

- 缺少身份返回 HTTP 401；
- 非 `leader` 返回 HTTP 403；
- 角色检查通过后才执行团长聚合查询。

返回内容：

- `group_buys`：全部、进行中、成功、失败数量；
- `rewards`：待生效、可用、提现处理中、已处理金额；
- `withdrawals`：状态数量与最近 5 条记录；
- `navigation.withdrawal_entry_available`；
- `updated_at`。

## 3. 奖励与提现口径

- 奖励仅来自团长本人真实有效团购订单；
- 仍为一层开团服务奖励，不引入上下级或团队关系；
- 待生效奖励来自 `Commission` 的 `estimated`、`frozen`、`pending`；
- 可用金额按 `RewardLedger` 中影响可用余额的 `in - out` 计算；
- 提现处理中金额来自 `Withdrawal.pending + Withdrawal.approved`；
- 已处理金额来自 `Withdrawal.paid`；
- 最近提现按 `created_at desc, id desc` 排序，最多 5 条；
- 小程序只展示人工审核、线下处理，不承诺自动到账。

所有 API 和数据库金额保持整数分，小程序通过统一工具格式化为元。

## 4. 敏感字段边界

两个中心接口和页面不得暴露：

- `openid`、`unionid`；
- 用户或收货手机号；
- 银行账户信息；
- 税务模式、税务状态、税额、税务备注；
- Admin 备注；
- 完整人工处理流水号；
- Prisma 原始错误或堆栈。

现有 `pages/mine` 中的 OpenID 展示已移除。

## 5. 小程序导航

- 原 `pages/mine` 原位升级为个人中心 V2；
- 保留购物车、订单、社区和自提点入口；
- 只有 `leader_center_available=true` 时显示团长中心入口；
- 团长中心复用现有 `/pages/leader/withdrawals/index`；
- 普通用户收到 403 后展示无权限状态，不自动重试；
- 刷新失败时保留上一次成功摘要。

固定合规说明：

> 开团服务奖励只来自本人真实有效团购订单；提现由后台人工审核并线下处理。

## 6. 数据库与依赖

L47：

- 无新增表；
- 无新增字段；
- 无新增 migration；
- 不修改 `package.json`；
- 不修改 `pnpm-lock.yaml`；
- 复用 `User`、`Order`、`AfterSaleCase`、`GroupBuy`、`Commission`、`RewardLedger`、`Withdrawal`。

## 7. 测试结构

### 聚焦单元与路由测试

- `apps/api/src/modules/me-center/me-center-service.test.ts`
- `apps/api/src/modules/me-center/me-center-routes.test.ts`

### L47 静态契约

- `scripts/verify-l47-miniapp-profile-leader-center-local.ts`

### L47 隔离式 Docker E2E

- `scripts/run-l47-center-docker-api-e2e-local.ts`
- `scripts/verify-l47-center-docker-api-e2e-local.ts`

隔离 bootstrap 直接启动当前分支 `buildApp()` 到随机端口，避免依赖 Compose 中另一个 watch 进程的状态。

E2E 必须输出十个 marker：

- `l47_me_center_summary_success=true`
- `l47_me_center_order_counts_verified=true`
- `l47_me_center_after_sale_count_verified=true`
- `l47_leader_center_summary_success=true`
- `l47_leader_group_buy_counts_verified=true`
- `l47_leader_reward_amounts_verified=true`
- `l47_leader_withdrawal_summary_verified=true`
- `l47_non_leader_forbidden=true`
- `l47_sensitive_fields_absent=true`
- `l47_miniapp_navigation_verified=true`

### 报告与阶段门禁

- `scripts/verify-l47-report-routing-local.ts`
- `scripts/l47-report-evidence-hook.ts`
- `scripts/verify-l47-report-publish-local.ts`
- L47 报告源：`stable/l46-business-base`
- L47 报告基线 commit：`fe7b8c185816912d5e198dc960f8b979b532525f`

L47 报告必须绑定当前 HEAD。不同 commit 的验证输出、缺少任意命令 evidence 或缺少任意 runtime marker 时，报告保持 `partial`，不得发布为 `passed`。

## 8. 最终验证命令

聚焦阶段：

```bash
docker compose exec -T api sh -lc '
cd /app &&
pnpm exec tsx scripts/stage-workflow.ts --stage=L47 --verify --scope=stage
'
```

完整 chain 与本地 no-push 报告发布：

```bash
docker compose exec -T api sh -lc '
cd /app &&
pnpm exec tsx scripts/stage-workflow.ts --stage=L47 --publish --scope=chain
'
```

发布过程必须依次完成：

1. L47 verifier；
2. L47 隔离式中心 E2E；
3. L47 报告路由 verifier；
4. L24–L47 chain；
5. 原全局 Docker API E2E；
6. Admin typecheck config；
7. Admin full typecheck；
8. raw compliance scan；
9. Stage workflow；
10. L47 strict report publish verifier；
11. 本地 `stage-reports` 分支写入。

不得启用 auto-merge。
