# L50-C2-T3-C 库存调整可靠命令设计

- 任务：`L50-C2-T3-C`
- 基线：`stable/l50-a3-4-business-base`
- 开发分支：`codex/l50-c2-t3c-inventory-adjust-command`
- 日期：2026-07-25
- 上游：L50-C2-T1 订单可靠写入、L50-C2-T2 自提核销、L50-C2-T3-A 退款可靠命令、L50-C2-T3-B 提现可靠命令

## 1. 结论

本阶段采用“人工库存调整专用命令 + 复用 C2 可靠写入原语”方案，只治理后台现有 `POST /api/admin/inventory/products/:id/adjust` 写入口。Admin 必须提交页面可见的 `expected_stock`、本次 `adjust_quantity`、原因和新的 `idempotency_key`；API 使用 PostgreSQL 条件原子更新防止并发覆盖，并把商品库存、`StockLedger`、一条管理员审计、一条业务事件和 `AdminCommandReceipt` 成功回执放入同一事务。

本阶段不建立通用库存命令平台，不治理采购入库、批次损耗、盘点确认、订单扣减、退款库存回补、配送取消或 POS 同步，也不改变库存单位模型。

## 2. 已核验现状

### 2.1 现有写入存在并发覆盖

`adjustStockByAdmin()` 当前先 `findUnique()` 读取 `Product.stock`，在应用层计算 `stockAfter`，再按商品 ID 普通 `update()`。两个请求可以读取相同旧库存并先后覆盖，导致一个调整静默丢失。

### 2.2 现有事务副作用不完整

路由已经把商品更新、`StockLedger` 和 `AdminAuditLog` 放在同一 Prisma 事务中，但目前：

- 没有 `AdminCommandReceipt`，相同请求重试会重复调整；
- 没有 `BusinessEventLog`，业务观测链不完整；
- `StockLedger` 没有填写本次人工调整的 `idempotency_key`、`event_type` 和 `quantity_delta`；
- 失败统一映射为 400，调用方无法区分输入错误、找不到商品、库存冲突和内部失败。

### 2.3 Admin 没有并发令牌

`adjustInventory()` 只发送调整量和原因；页面提交时不发送当前库存，没有防重复提交状态，冲突时也不会自动刷新。

### 2.4 可复用上游原语

- `AdminCommandReceipt` 已按 `(admin_user_id, idempotency_key)` 唯一；
- C2 命令已经形成严格请求解析、SHA-256 请求哈希、同请求安全重放、同键异请求拒绝、条件写入和事务内完成回执的模式；
- `product.manage` 已存在，当前库存页面可继续使用该权限；
- `StockLedger` 已支持 `idempotency_key`、`event_type` 和 `quantity_delta`。

## 3. 方案比较

### 3.1 方案 A：只收口人工库存调整（采用）

保留现有 URL，新增专用解析器和执行器，只调整商品总库存并写完整副作用。范围最小，可直接消除当前可见的并发覆盖和重复提交风险。

### 3.2 方案 B：统一所有库存写入

把采购、损耗、盘点、订单扣减和退款回补同时迁移到统一命令层。长期一致性更强，但会同时触及批次库存、订单和退款状态机，PR 风险与验证矩阵过大，本阶段否决。

### 3.3 方案 C：引入独立库存服务或队列

通过新服务串行处理库存命令。当前模块化单体和 MVP 规模不需要 Redis、MQ 或微服务；会增加部署与故障面，本阶段否决。

## 4. API 合同

### 4.1 写入口

```http
POST /api/admin/inventory/products/:id/adjust
Permission: product.manage
Content-Type: application/json

{
  "expected_stock": 20,
  "adjust_quantity": -3,
  "reason": "门店盘点差异",
  "idempotency_key": "inventory-adjust-<uuid>"
}
```

只接受上述四个请求字段：

- `expected_stock`：0 到 `Number.MAX_SAFE_INTEGER` 的安全整数；
- `adjust_quantity`：非零安全整数；
- `reason`：去除首尾空白后 1–200 个 JavaScript 代码单元，不允许控制字符；
- `idempotency_key`：去除首尾空白前后必须一致，16–128 个可打印 ASCII 字符。

`expected_stock + adjust_quantity` 必须仍是 0 到 `Number.MAX_SAFE_INTEGER` 的安全整数。请求出现未知字段、缺失字段、浮点数、越界值或非法文本时返回 400。

### 4.2 成功响应

使用 C1 V1 envelope，HTTP 200、code 固定为 `ADMIN_INVENTORY_ADJUSTED`，`data` 固定为：

```json
{
  "product_id": "product-id",
  "stock_before": 20,
  "stock_after": 17,
  "adjust_quantity": -3,
  "stock_unit": "份"
}
```

同请求成功重放必须返回同一稳定结果，不重新读取并替换为商品的更新后库存。

### 4.3 权限

路由使用 `requireAdminPermissionV1('product.manage')`。权限在每次普通请求和每次成功回放前都重新检查；权限丢失后不得通过旧回执读取结果。商品当前没有社区或自提点归属字段，本任务不伪造 data scope 规则。

## 5. 幂等、并发与事务

### 5.1 请求标识

操作名固定为 `admin.inventory.product.adjust.v1`。请求哈希包含：

- 操作名；
- 商品 ID；
- `expected_stock`；
- `adjust_quantity`；
- 规范化后的 `reason`。

幂等键本身不进入哈希。相同管理员、相同键、相同哈希且已有完整成功回执时返回原结果；相同键但哈希不同返回 409 `ADMIN_IDEMPOTENCY_KEY_REUSED`。损坏、未完成或非成功回执返回 500，不得重新执行命令。

### 5.2 条件更新

事务内先读取商品以区分 404 与冲突，再执行 Prisma `updateMany`：

- 条件：`id = :id AND stock = :expected_stock`；
- 变更：`stock = stock + :adjust_quantity`，使用 Prisma 原子 `increment`；
- 解析器已保证目标库存非负且为安全整数。

`updateMany.count !== 1` 返回 409 `ADMIN_INVENTORY_STOCK_CONFLICT`。这使两个不同幂等键、相同 `expected_stock` 的并发请求最多只有一个成功，另一个不得留下任何副作用。

### 5.3 单事务数据流

单个 PostgreSQL 事务按以下顺序执行：

1. 创建未完成的 `AdminCommandReceipt`；
2. 读取商品，确认存在且当前库存等于 `expected_stock`；
3. 条件原子增加或减少 `Product.stock`；
4. 读取更新后商品并构造稳定结果；
5. 创建一条 `StockLedger`：
   - `source_type = manual_adjust`；
   - `source_id = receipt.id`；
   - `idempotency_key = inventory-manual-adjust:<receipt.id>`；
   - `event_type = manual_adjust`；
   - `quantity_delta = adjust_quantity`；
   - `direction` 与调整正负一致；
   - `quantity = abs(adjust_quantity)`；
   - `stock_before/stock_after` 与命令结果一致；
6. 创建一条根级 `BusinessEventLog`：`event_type = inventory_manual_adjusted`、`event_source = admin-inventory-adjust-command`，商品 ID、前后库存、调整量和库存单位放入 payload；不得按历史流水或相关订单展开多条事件；
7. 创建一条 `AdminAuditLog`：`action = inventory_manual_adjusted`、`target_type = Product`、`target_id = product.id`，包含幂等键和前后快照摘要；
8. 完成 `AdminCommandReceipt`，写入 HTTP 200、成功 code、稳定结果和完成时间；
9. 提交事务。

任一步失败必须整体回滚，包括回执占位。不得留下已变更库存、孤立流水、业务事件或审计。

## 6. 代码边界

### 6.1 新增

- `apps/api/src/modules/inventory/admin-inventory-adjust-command.ts`：类型、严格解析、规范化和请求哈希；
- `apps/api/src/modules/inventory/admin-inventory-adjust-executor.ts`：回放、条件更新、事务、副作用和类型化错误；
- 两个模块的单元测试；
- 真实 PostgreSQL 集成测试；
- T3-C source contract 与聚焦 verifier。

### 6.2 修改

- `apps/api/src/routes/inventory.ts`：该调整入口改用 V1 权限保护、解析器、执行器和明确错误映射；其余库存、采购、批次、损耗和盘点路由保持原行为；
- `apps/api/src/modules/inventory/inventory-service.ts`：旧 `adjustStockByAdmin()` 不再作为生产写入口；删除该导出，避免出现第二条非可靠路径；
- `apps/admin/src/features/inventory/overview/api.ts`：发送 `expected_stock` 和每次点击生成的新 UUID，返回命令结果；
- `apps/admin/src/features/inventory/overview/InventoryOverviewPage.tsx`：同一商品提交期间禁用调整按钮；冲突后触发数据刷新并提示用户基于最新库存重试；成功后刷新；
- Admin API 单元测试和页面交互测试。

### 6.3 不修改

- Prisma schema 和 migration；
- 商品库存单位、销售单位与每份扣减规则；
- 采购入库、批次库存、批次损耗、盘点确认；
- 下单/支付库存扣减和退款库存回补；
- 退款、提现、奖励、配送或 POS；
- `package.json`、`pnpm-lock.yaml` 和依赖版本。

## 7. 错误合同

| HTTP | code | 含义 |
|---|---|---|
| 400 | `INVALID_ADMIN_INVENTORY_ADJUST_COMMAND` | 请求结构、数值或文本不合法 |
| 401 | `ADMIN_UNAUTHORIZED` | 管理员身份无效 |
| 403 | `ADMIN_FORBIDDEN` | 缺少 `product.manage` |
| 404 | `ADMIN_INVENTORY_PRODUCT_NOT_FOUND` | 商品不存在 |
| 409 | `ADMIN_IDEMPOTENCY_KEY_REUSED` | 幂等键已对应不同请求 |
| 409 | `ADMIN_INVENTORY_STOCK_CONFLICT` | 当前库存已变化或目标库存不再成立 |
| 500 | `ADMIN_INVENTORY_ADJUST_FAILED` | 未分类内部失败或回执损坏；不得泄露内部异常 |

409 响应不返回服务端当前库存，Admin 必须重新加载概览，避免在错误响应中建立第二套状态合同。

## 8. Admin 交互

- 用户点击库存调整时，页面以该行当前 `stock` 作为 `expected_stock`；
- 每次确认提交时生成一个新的 `crypto.randomUUID()`；
- 同一商品存在未完成请求时禁用“库存调整”，其他商品不受影响；
- 成功后提示“库存调整已保存”并刷新库存概览；
- 409 时提示“库存已变化，已刷新，请基于最新库存重试”并刷新；
- 其他错误沿用全局 Admin 错误展示，不展示成功提示；
- 不把 prompt 表单扩展成新的复杂弹窗，本任务只治理可靠写入。

## 9. 验证设计

### 9.1 解析与请求哈希单元测试

- 拒绝未知字段、缺失字段、浮点数、零调整、负 `expected_stock`、目标负库存、安全整数溢出、非法幂等键、空原因、过长原因和控制字符；
- 正确规范化原因；
- 相同规范化命令哈希稳定，任一业务字段变化都会改变哈希。

### 9.2 执行器单元/合同测试

- 成功结果形状固定；
- 相同键相同请求安全重放；
- 相同键不同请求拒绝；
- 未完成或损坏回执拒绝；
- 生产代码只写一条业务事件，不读取相关订单或历史流水进行事件展开；
- 旧 `adjustStockByAdmin()` 生产入口和旧路由调用被删除。

### 9.3 真实 PostgreSQL 集成测试

- 正向与负向调整成功；
- 目标为零成功，目标为负数在写入前拒绝；
- 不存在商品返回 404 且零写入；
- 旧库存返回 409 且零写入；
- 相同键相同请求重放只产生一次库存变化、一条流水、一条业务事件和一条审计；
- 相同键不同请求返回 409；
- 两个不同键并发相同 `expected_stock` 时恰好一个成功、一个 409，最终库存只变化一次；
- 对 `StockLedger`、`BusinessEventLog`、`AdminAuditLog` 和回执完成逐一注入失败，证明商品库存和全部副作用回滚；
- 业务事件数量与单次命令保持 O(1)，不随历史订单、流水或关联记录数量增长。

### 9.4 Admin 测试

- API 客户端发送四个字段并返回结果；
- UUID 每次提交重新生成；
- 提交期间同商品按钮禁用；
- 成功刷新并提示；
- 409 刷新且不显示虚假成功。

### 9.5 发布门禁

- 聚焦单元与 source contract；
- 真实 PostgreSQL 集成；
- Admin 类型检查和聚焦测试；
- `pnpm verify:all`；
- 真实 Admin 浏览器并发场景；
- 基线审计；
- 安全与原子性审查无 Critical/Important。

## 10. 完成定义

T3-C 只有在以下条件同时成立时完成：

- 人工库存调整只有一条生产写入口；
- 幂等重试不重复改变库存或副作用；
- 并发旧库存命令最多一个成功，不发生静默覆盖；
- 商品、流水、业务事件、审计和回执全部同事务提交或回滚；
- `product.manage` 权限和 V1 错误合同生效；
- Admin 成功与冲突交互正确；
- 真实 PostgreSQL 并发和失败注入验证通过；
- 未触及明确排除的库存/订单/退款/POS 范围。
