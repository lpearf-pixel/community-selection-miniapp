# L47 小程序个人中心 V2 / 团长中心设计

## 1. 目标与阶段边界

L47 只增强用户侧个人中心与团长中心，复用 L24-L46 已有订单、售后、团购、开团服务奖励和人工提现能力，不新增数据库表或字段，不修改依赖文件，不开发 L48 安全隐私收口内容。

本阶段交付：

- 所有已登录用户可访问的个人中心 V2；
- 仅开团人可访问的团长中心；
- 两个只读汇总 API；
- 复用现有人工提现页面，不重复实现提现提交逻辑；
- L47 静态 verifier、Docker E2E 场景、L24-L47 chain 和独立阶段报告。

本阶段禁止：

- 多级分销、团队收益、拉人计酬、排行榜、增长活动；
- 优惠券、会员、裂变能力；
- 自动打款、自动报税或外部银行/税务平台；
- 修改 `package.json`、`pnpm-lock.yaml`；
- 提交 `reports/` 或 `.tmp/`；
- 新增 Prisma migration；
- 在用户响应中暴露 openid、手机号、银行卡、人工处理备注或完整人工流水号。

## 2. 方案选择

采用“双中心分层”方案。

- 个人中心负责所有用户共有的身份、订单、履约与售后摘要。
- 团长中心负责开团、开团服务奖励与人工提现摘要。
- 个人中心只返回是否显示团长中心入口，不混入团长财务数据。
- 团长提现操作继续跳转到现有 `pages/leader/withdrawals/index`。

该边界避免单个超级 API 混合普通用户和团长权限，也避免小程序并行调用多个业务接口后自行拼接统计口径。

## 3. API 设计

### 3.1 `GET /api/me/center-summary`

身份来源沿用现有用户侧认证约定，生产逻辑不得信任客户端传入的任意 user id。

响应字段：

```ts
type MeCenterSummary = {
  profile: {
    user_id: string;
    nickname: string | null;
    avatar_url: string | null;
    role: 'user' | 'leader';
  };
  orders: {
    total_count: number;
    unpaid_count: number;
    pending_fulfillment_count: number;
    ready_for_pickup_count: number;
    in_delivery_count: number;
    completed_count: number;
  };
  after_sales: {
    pending_count: number;
  };
  navigation: {
    leader_center_available: boolean;
  };
  updated_at: string;
};
```

统计规则：

- 所有数量均为当前用户自己的记录；
- 订单状态使用既有字段和既有状态集合，不创建 L47 私有状态；
- `pending_fulfillment_count`、`ready_for_pickup_count`、`in_delivery_count` 必须在服务层集中定义，API、verifier 和 E2E 共用同一口径说明；
- 售后只统计仍需处理的已有状态，不把已完成或已关闭售后计入；
- `leader_center_available` 仅由服务端用户角色决定。

### 3.2 `GET /api/leaders/me/center-summary`

仅 `role=leader` 可访问。未登录返回 401，已登录非团长返回 403。

响应字段：

```ts
type LeaderCenterSummary = {
  group_buys: {
    total_count: number;
    active_count: number;
    success_count: number;
    failed_count: number;
  };
  rewards: {
    pending_cents: number;
    available_cents: number;
    withdrawing_cents: number;
    withdrawn_cents: number;
  };
  withdrawals: {
    pending_count: number;
    approved_count: number;
    rejected_count: number;
    processed_count: number;
    latest: Array<{
      withdrawal_id: string;
      amount_cents: number;
      status: string;
      status_text: string;
      created_at: string;
    }>;
  };
  navigation: {
    withdrawal_entry_available: boolean;
  };
  updated_at: string;
};
```

统计规则：

- 金额全部使用整数分；
- 开团数据只统计当前开团人拥有的 GroupBuy；
- `pending_cents` 与 `available_cents` 复用 Commission / RewardLedger 既有规则，不能重新发明奖励公式；
- `withdrawing_cents` 统计仍处于人工处理流程中的提现金额；
- `withdrawn_cents` 只统计已完成处理的历史金额；
- `latest` 最多返回 5 条，按 `created_at desc, id desc` 稳定排序；
- 不返回税务字段、手机号、人工备注、未脱敏流水号或 Commission 内部审计字段；
- `withdrawal_entry_available` 仅表示可进入人工提现页面，不承诺自动到账。

## 4. 后端结构

建议新增：

```text
apps/api/src/modules/me-center/me-center-service.ts
apps/api/src/modules/me-center/me-center-types.ts
apps/api/src/routes/me/center.ts
apps/api/src/routes/leaders/center.ts
```

若现有路由注册方式不使用目录结构，则遵循仓库当前模式注册，但必须保持普通用户和团长路由分离。

职责：

- Route：认证、错误码映射、响应 envelope；
- Service：查询编排、状态口径和 DTO 映射；
- Types：稳定 API DTO 与状态集合；
- 不在 route 中堆叠多段 Prisma 查询；
- 不向小程序暴露 Prisma 原始对象。

所有聚合优先使用数据库 count/aggregate；不得先加载完整订单、团购、奖励或提现列表再在内存统计。

## 5. 小程序结构

新增或增强：

```text
apps/miniapp/pages/profile/index.js
apps/miniapp/pages/profile/index.json
apps/miniapp/pages/profile/index.wxml
apps/miniapp/pages/profile/index.wxss
apps/miniapp/pages/leader/center/index.js
apps/miniapp/pages/leader/center/index.json
apps/miniapp/pages/leader/center/index.wxml
apps/miniapp/pages/leader/center/index.wxss
apps/miniapp/utils/center.js
apps/miniapp/app.json
```

### 5.1 个人中心 V2

页面区块：

1. 用户身份区：头像、昵称、普通用户/开团人身份；
2. 我的订单：待付款、待履约、待取货、配送中、已完成；
3. 售后入口：展示处理中数量；
4. 团长中心入口：仅 `leader_center_available=true` 展示；
5. 统一 loading、empty、error、retry；
6. 页面重新显示时刷新摘要，防止订单或售后状态陈旧。

### 5.2 团长中心

页面区块：

1. 开团概览：进行中、成功、失败；
2. 开团服务奖励：待生效、可提现、提现处理中、已处理；
3. 提现记录摘要：最近 5 条；
4. “申请提现”跳转已有 `pages/leader/withdrawals/index`；
5. 固定说明：奖励只来自本人真实有效团购订单；提现由后台人工审核和线下处理，不代表自动到账；
6. loading、empty、error、retry；
7. 非团长接口 403 时返回个人中心或展示无权限提示，不循环重试。

金额展示统一通过公共工具将整数分格式化为字符串，WXML 不直接使用 `amount_cents / 100` 作为最终展示逻辑。

## 6. 数据流与错误处理

### 6.1 页面加载

- 页面调用 `apps/miniapp/utils/center.js`；
- 工具层调用现有 `request` 封装；
- 请求成功后只写入 DTO；
- 请求失败保留上次成功数据但展示刷新失败提示，首次加载失败展示完整错误态；
- 使用请求序号或页面级 loading guard 防止旧请求覆盖新请求。

### 6.2 HTTP 语义

- 401：未登录，沿用现有登录恢复流程；
- 403：已登录但不是团长；
- 404：只用于真实不存在的资源，不用于角色隐藏；
- 500：统一错误 envelope，不返回 SQL、Prisma、堆栈或敏感字段；
- 汇总为空时返回零值结构，不返回 `null` 替代整个 section。

## 7. 同步测试设计

测试与实现并行推进，不在功能结束后补写。

### 7.1 第一批：契约与静态 verifier

新增：

```text
scripts/l47-center-contract.ts
scripts/verify-l47-miniapp-profile-leader-center-local.ts
```

先写失败断言，覆盖：

- 两个 API 路径和认证边界；
- DTO 不包含敏感字段；
- 金额字段均以 `_cents` 结尾且为整数语义；
- 团长中心复用现有提现页面；
- 小程序不出现排行榜、团队收益、拉人计酬、自动到账等禁止语义；
- `package.json`、`pnpm-lock.yaml`、Prisma schema/migrations 不属于 L47 允许变更；
- L47 注册到 stage registry、workflow 和 report contract。

### 7.2 第二批：服务层测试

覆盖：

- 普通用户订单与售后状态统计；
- 团长入口显示条件；
- 团长开团统计；
- pending / available / withdrawing / withdrawn 金额口径；
- 最近提现稳定排序和最多 5 条；
- 非团长访问团长汇总返回 403；
- 无数据时返回完整零值 DTO；
- 不返回敏感字段。

### 7.3 第三批：Docker E2E

在现有 `scripts/verify-docker-api-e2e-local.ts` 增加独立、可重复运行的 L47 fixture，所有唯一字段带 run token。

必须产生明确 marker：

```text
l47_me_center_summary_success=true
l47_me_center_order_counts_verified=true
l47_me_center_after_sale_count_verified=true
l47_leader_center_summary_success=true
l47_leader_group_buy_counts_verified=true
l47_leader_reward_amounts_verified=true
l47_leader_withdrawal_summary_verified=true
l47_non_leader_forbidden=true
l47_sensitive_fields_absent=true
l47_miniapp_navigation_verified=true
```

### 7.4 阶段门禁

最终必须运行：

- L47 verifier；
- L24-L47 chain regression；
- raw compliance scan；
- Docker API E2E；
- Miniapp 静态契约检查；
- `git diff --check`；
- L47 report generation、publish verifier 和 no-push 演练；
- 报告单独发布到 `stage-reports`，业务 PR 不提交 `reports/`。

## 8. 交付与分支策略

- 稳定基线：`stable/l46-business-base`，指向 `fe7b8c185816912d5e198dc960f8b979b532525f`；
- 开发分支：`work/l47-miniapp-profile-leader-center-v2`；
- 先提交设计和实施计划，再提交测试契约，再提交业务实现；
- 每个提交保持单一职责；
- PR 目标分支为 `stable/l46-business-base`；
- 不自动合并，等待人工 review；
- 合并后再创建 `stable/l47-business-base`。

## 9. 验收标准

L47 只有在以下条件全部满足时才算完成：

1. 普通用户个人中心可用，数据只属于当前用户；
2. 团长中心只对团长开放；
3. 奖励和提现金额口径复用现有业务规则；
4. 现有提现页可从团长中心进入，且人工处理提示明确；
5. 无敏感字段泄露，无禁止业务语义；
6. 无 DB、依赖和 L48 范围外变更；
7. L47 verifier、L24-L47 chain、Docker E2E、合规扫描和报告门禁全部通过；
8. `stage-reports` 中 L47 metadata 的 `source_commit` 等于最终业务分支 HEAD；
9. Fresh review 没有 Critical 或 Important 阻断项。
