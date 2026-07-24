# L50-C2-T1 订单接口安全收口与可靠写入设计

- 任务：L50-C2-T1
- 基线：`stable/l50-a3-4-business-base`
- 设计分支：`codex/l50-c2-t1-order-write-contract`
- 日期：2026-07-24
- 上游：L50 统一商业后台规格、L50-C1 API 契约基础、L50-C1.5 页面治理

## 1. 结论

本阶段采用“单个订单状态写入闭环先验证”方案：先把 Admin 订单状态更新从未保护的公共路由迁入 `/api/admin`，再用订单版本和管理员命令回执实现乐观并发与幂等重放。订单变更、业务事件、管理员审计、订单时间线、完成订单的奖励副作用和幂等回执必须在同一个 PostgreSQL 事务内提交。

本阶段不一次迁移退款、提现、库存调整等全部高风险写入，也不提前实现 outbox/inbox。C2-T1 的可靠写入模式经过真实 PostgreSQL 并发验证后，再复用于 C2-T2 自提核销和 C2-T3 退款、提现与库存调整。

## 2. 已核验现状

### 2.1 安全边界

`apps/api/src/app.ts` 的全局管理员认证只覆盖 `/api/admin*`。当前 Admin 订单页的 `updateOrderStatus()` 仍调用：

```text
POST /api/orders/:id/status
```

因此该写接口不受管理员 Session/token、`order.manage` 或 data scope 保护。

`apps/api/src/routes/group-buys.ts` 还暴露以下旧接口：

- `GET /api/orders`：返回全量订单和用户、收货相关联数据；
- `GET /api/orders/:id`：按 ID 返回订单详情；
- `GET /api/orders/export/picking.csv`：导出分拣数据；
- `POST /api/orders/:id/status`：推进订单状态；
- `POST /api/orders/:id/complete`：推进或完成订单。

公开下单接口 `POST /api/orders` 和 `POST /api/orders/normal` 属于消费者业务入口，必须保留。

### 2.2 并发与副作用

当前 `updateOrderStatus()`：

1. 在事务外读取订单；
2. 只按 `id` 更新订单，不检查版本；
3. 在事务内写业务事件、管理员审计和订单时间线；
4. 完成订单时调用奖励副作用。

两个并发请求可能读取同一旧状态并分别成功更新，导致重复时间线、审计、业务事件或完成副作用。当前请求没有写入幂等回执，服务无法区分“相同请求重试”和“不同命令复用同一键”。

### 2.3 已有可复用边界

- C1 已提供 V1 `contractOk` / `contractFail`、`trace_id`、`ExpectedVersion` 和 `IdempotencyKey` 类型。
- `GET /api/admin/orders` 已有 `order.view`、data scope、脱敏和稳定分页契约。
- `GET /api/admin/orders/:id` 已有 `order.view` 和逐订单 data scope 检查。
- `AdminOrderListItem` 尚未携带版本；Admin 状态更新仍使用旧公共接口。
- 管理员认证的全局 hook 和 `requireAdminPermission()` 仍返回旧 envelope，不能直接保证 C2 写接口的 V1 401/403。

## 3. 方案比较

### 3.1 方案 A：一次迁移全部后台高风险写入

优点是覆盖面大。缺点是会同时修改订单、自提、退款、提现、库存和多个 migration，无法隔离并发或幂等回归。否决。

### 3.2 方案 B：先实现 outbox/inbox

优点是接近未来同步架构。缺点是会在未保护、无版本的写边界上增加异步复杂度，并把错误接口固化为事件生产者。否决。

### 3.3 方案 C：单个订单闭环先验证

先收口状态写接口，建立一套可复用的版本、命令回执、事务和错误契约，再扩展到其他高风险写入。采用。

## 4. 范围

### 4.1 包含

- 审计仓库内 `/api/orders*` 的调用者；
- Admin 状态更新迁移到 `POST /api/admin/orders/:id/status`；
- `order.manage`、管理员身份、订单 data scope 与 V1 错误 envelope；
- `Order.version`；
- 管理员命令幂等回执表；
- `expected_version` 和 `idempotency_key` 请求契约；
- 条件更新、并发冲突、相同请求重放和不同内容复用键冲突；
- 状态更新、审计、业务事件、时间线、奖励副作用和回执的单事务提交；
- 旧公共订单查询、详情、导出、状态和完成接口关闭；
- Admin 分拣导出补齐 `order.view` 与订单 data scope；
- 现有 Admin 自提核销入口补齐 `pickup.verify` 与 data scope 的安全门禁；其版本和幂等语义留给 C2-T2；
- 真实 PostgreSQL 并发、Admin Session、Playwright 和清理证据。

### 4.2 不包含

- 修改消费者下单接口；
- 修改支付、退款、售后、提现或库存业务语义；
- 为自提核销实现版本和幂等回执；
- outbox、inbox、worker、死信或 fake POS connector；
- 门店、渠道、设备或外部 ID 模型；
- 微服务、Redis、MQ 或新依赖；
- 全局迁移所有 Admin endpoint 到 V1 envelope。

## 5. API 契约

### 5.1 请求

```http
POST /api/admin/orders/:id/status
Content-Type: application/json

{
  "next_status": "ready",
  "expected_version": 3,
  "idempotency_key": "5df8a980-9c91-4b80-a252-f923b71d74fd"
}
```

约束：

- `next_status` 保持现有允许集合：`preparing | ready | picked | delivered | completed`；
- `expected_version` 必须是大于等于 1 的安全整数；
- `idempotency_key` 必须是 16–128 个可打印 ASCII 字符，前后不得有空白；
- URL 中的订单 ID、目标状态、expected version 和操作名都进入请求摘要；
- Admin 客户端使用 `crypto.randomUUID()` 生成键；同一次传输重试必须复用原键。

### 5.2 成功

HTTP 200：

```json
{
  "success": true,
  "data": {
    "order_id": "order-id",
    "order_no": "O...",
    "order_status": "ready",
    "version": 4,
    "completed_at": null
  },
  "code": "ADMIN_ORDER_STATUS_UPDATED",
  "message": "",
  "trace_id": "request-id"
}
```

相同管理员、相同 idempotency key、相同请求摘要的重试返回首次成功保存的 `data` 和相同业务 `code`，但 `trace_id` 使用当前 HTTP 请求 ID。重放不得再次更新订单或新增审计、时间线、业务事件和奖励副作用。

### 5.3 错误

| HTTP | code | 条件 |
|---:|---|---|
| 400 | `INVALID_ADMIN_ORDER_STATUS_COMMAND` | body、状态、版本或幂等键不合法 |
| 401 | `ADMIN_UNAUTHORIZED` | 未建立有效管理员身份 |
| 403 | `ADMIN_FORBIDDEN` | 缺少 `order.manage` |
| 403 | `ADMIN_ORDER_SCOPE_FORBIDDEN` | 订单不在 data scope |
| 404 | `ADMIN_ORDER_NOT_FOUND` | 订单不存在 |
| 409 | `ADMIN_ORDER_VERSION_CONFLICT` | 当前版本与 expected version 不同 |
| 409 | `ADMIN_IDEMPOTENCY_KEY_REUSED` | 同一管理员复用键但请求摘要不同 |
| 500 | `ADMIN_ORDER_STATUS_UPDATE_FAILED` | 未预期内部错误 |

所有响应使用 V1 envelope 和当前请求 `trace_id`。500 只返回公开消息，数据库异常只写入脱敏服务日志。

## 6. 数据模型与 migration

### 6.1 订单版本

向 `Order` 增加：

```prisma
version Int @default(1)
```

现有订单通过数据库默认值回填为 1。每次受 C2 可靠写入保护的订单 mutation 成功后原子执行 `version = version + 1`。

### 6.2 管理员命令回执

新增逻辑模型：

```prisma
model AdminCommandReceipt {
  id                  String   @id @default(cuid())
  admin_user_id       String
  idempotency_key     String
  operation           String
  target_id           String
  request_hash        String
  response_http_status Int?
  response_code       String?
  response_data       Json?
  completed_at        DateTime?
  created_at          DateTime @default(now())

  @@unique([admin_user_id, idempotency_key])
  @@index([operation, target_id])
  @@index([created_at])
}
```

决策：

- 幂等键按管理员作用域唯一，避免不同管理员偶然使用相同 UUID 相互阻塞；
- `request_hash` 是规范化命令的 SHA-256，不保存敏感原始 body；
- 新事务先创建仅在当前事务内可见的占位回执；提交前必须一次性填满 response 字段和 completed_at；
- 业务事务失败时占位回执随事务回滚；读取到任何不完整回执时 fail closed 并记录内部错误，不能重做业务写入；
- 回执不设置短期自动清理，避免在重试窗口内丢失幂等语义；后续统一保留策略另行设计；
- response 仅保存安全 DTO，不保存手机号、地址、token 或数据库异常。

### 6.3 发布与回滚

migration 只增加列、表、唯一键和索引，不删除或改写现有字段。发布顺序：

1. 应用 additive migration；
2. 部署读取版本并接受新命令契约的 API/Admin；
3. 验证新接口后关闭旧公共接口。

应用回滚时保留 additive schema，旧版本代码可忽略新增列和表。不得在紧急回滚中删除回执或把订单版本降回旧值。只有确认没有新代码和数据依赖后，才可另开显式清理 migration。

## 7. 事务与并发算法

每个新状态命令按以下顺序执行：

1. 完成认证、`order.manage` 和请求格式校验；
2. 解析管理员 context，计算规范请求摘要；
3. 开启 PostgreSQL 事务；
4. 尝试创建 `(admin_user_id, idempotency_key)` 回执占位；
5. 若唯一键冲突，当前候选事务回滚；在事务外等待首次事务完成后读取既有回执；
6. 对既有回执先比较摘要：不同则返回 409；相同时重新读取目标订单并按管理员当前 data scope 授权，通过后才返回保存结果；
7. 新命令在事务内读取订单并执行 data scope、支付状态和现有目标状态校验；
8. 使用 `id + version = expected_version` 条件更新订单并递增版本；
9. 条件更新数量为 0 时返回版本冲突，整个事务（包括回执占位）回滚；
10. 写业务事件、管理员审计、订单时间线；
11. 若目标为 completed，执行现有奖励副作用；
12. 写入安全 response snapshot、response code、HTTP status 和 completed_at 后提交事务。

并发保证：

- 不同 idempotency key、相同 expected version 的两个命令最多一个成功；
- 相同键和相同摘要的并发请求只有一个执行，其余读取首次结果；
- 相同键和不同摘要必定 409；
- 任一步失败都不留下部分订单更新、部分日志、部分奖励或不完整回执。

## 8. 认证、权限与 data scope

### 8.1 V1 路由认证

全局 `/api/admin` 认证 hook 读取 route config；仅对标记为 C2 V1 的路由使用 `contractFail()` 返回 traceable 401。未标记的旧 Admin 路由保持原 envelope，避免本阶段全局行为漂移。

新增 V1 管理员 permission guard，返回 traceable 401/403。新状态路由必须要求 `order.manage`，不能只依赖导航可见性。

### 8.2 资源范围

在任何写入前加载订单并执行 `canAccessOrderDataScope()`。范围失败返回 403，不通过 404 隐藏，因为 Admin 审计需要区分资源不存在和越权尝试；日志不得包含收货敏感字段。

Admin 分拣导出必须使用 `order.view` 并将 `getScopedOrderWhere()` 合入查询。无任何可访问范围时返回空文件或 403，具体采用 403 以避免误认为“当天无订单”。

现有 `/api/admin/orders/:id/pickup-verify` 在 C2-T1 只补齐 `pickup.verify` 和逐订单 scope 门禁；C2-T2 再迁移其版本、幂等和事务回执。

## 9. 旧接口退役

保留：

- `POST /api/orders`
- `POST /api/orders/normal`
- `/api/me/orders*` 用户本人订单接口
- 已保护的 `/api/admin/orders*` 读取接口

退役：

- `GET /api/orders`
- `GET /api/orders/:id`
- `GET /api/orders/export/picking.csv`
- `POST /api/orders/:id/status`
- `POST /api/orders/:id/complete`

实施前必须用仓库级文本审计和现有测试确认调用者。发现生产调用者时先迁移到 `/api/me` 或 `/api/admin`，再删除旧路由；不得用临时兼容代理继续保留未认证访问。退役接口在契约测试中必须返回 404。

## 10. Admin 客户端

- `AdminOrderListItem` 和订单详情 DTO 增加 `version`；
- `updateOrderStatus()` 改用 `/api/admin/orders/:id/status`；
- 请求包含当前列表项的 `expected_version` 和新 idempotency key；
- mutation 成功后沿用 `onMutationCommitted()` 刷新列表；
- 409 显示“订单已被其他操作更新，请刷新后重试”，不得静默覆盖；
- 按钮不进行乐观状态覆盖，保持服务端为事实源；
- 当前阶段不改变表格列、按钮、文案和允许目标状态。

## 11. 测试与门禁

### 11.1 RED 证据

实现前新增测试并确认失败原因正确：

- Admin API 边界仍调用旧公共状态接口；
- 旧公共查询、导出和写入仍可达；
- Order 尚无 version；
- 幂等回执模型尚不存在；
- 当前服务允许两个相同 expected version 写入；
- 状态接口缺少 V1 401/403/409 和 data scope。

### 11.2 聚焦验证

使用真实 PostgreSQL 证明：

1. 未认证为 401，缺权限和越权为 403；
2. 合法命令从版本 N 更新到 N+1；
3. 两个不同键并发使用版本 N，只有一个 200，另一个 409；
4. 相同键相同摘要串行和并发重试返回同一业务结果；
5. 相同键不同状态、版本或订单 ID 返回 409；
6. 重放不增加 `BusinessEventLog`、`AdminAuditLog`、`OrderTimelineLog` 或奖励记录；
7. 模拟副作用失败时订单、日志和回执全部回滚；
8. 旧公共接口返回 404；
9. Admin 导出只包含 data scope 内订单；
10. 自提安全门禁拒绝无权限和越权请求。

### 11.3 浏览器证据

E2E fixture 必须显式创建一笔已支付、可推进状态的真实订单，不依赖 seed 或数据库碰巧存在订单。Playwright 完成：

1. Session 登录；
2. 打开订单页并读取版本；
3. 点击一个状态按钮；
4. 捕获新 Admin endpoint 的 expected version 和幂等键；
5. 验证成功 envelope、刷新后的新状态和版本；
6. 用旧版本发起第二个命令并验证 409；
7. 验证页面仍可刷新和继续导航。

### 11.4 完整门禁

最终 head 必须通过：

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
Admin auth runtime contracts
真实 PostgreSQL 并发/回滚测试
真实 PostgreSQL + Playwright Admin E2E
cleanup contracts
```

自托管 Runner 继续使用单 workspace 任务、Vitest 1–2 workers 和 3 GiB Node heap。临时任务 workflow 在最终合并前删除。

## 12. 验收标准

- Admin 不再调用未认证订单状态接口；
- 旧公共订单列表、详情、导出和状态写入全部不可达；
- 状态写入强制管理员身份、`order.manage` 和 data scope；
- 订单版本由数据库条件更新保证，而不是只在应用内比较；
- 相同 expected version 的并发写最多成功一次；
- 幂等重放不重复产生任何业务副作用；
- 失败响应稳定、可追踪且不暴露数据库信息；
- migration 为 additive，应用可在保留新 schema 时回滚；
- E2E 显式创建真实订单并验证状态与版本；
- 无 POS、outbox、退款、提现或库存业务扩张。

## 13. 后续顺序

1. C2-T2：自提核销可靠写入；
2. C2-T3：退款、提现、库存调整等高风险写入；
3. C3：跨模块直接写与数据所有权治理；
4. L50-D：outbox/inbox、重试、死信和 fake POS connector。
