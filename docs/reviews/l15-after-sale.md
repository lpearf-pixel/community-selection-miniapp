# L15 售后客服与生鲜问题处理验收说明

## 功能说明

L15 新增售后客服模块，用于处理社区团购订单中的生鲜售后问题：品质问题 / 坏果、少称、漏发、错发、不新鲜、破损和其他人工问题。模块围绕 `AfterSaleCase` 与 `AfterSaleLog` 建模，支持用户提交、取消，后台审核、解决、备注和关联库存损耗。

本阶段保持 L14.5 模块化路由结构：公共售后路由注册在 public registry，后台售后路由注册在 admin registry，`app.ts` 仍只注册顶层 public/admin 入口。

## API 列表

### 用户侧

- `POST /api/after-sales`：创建售后工单。
- `GET /api/after-sales`：查询售后列表，支持 `order_id` / `status` / `type` 过滤。
- `GET /api/after-sales/:id`：查询售后详情。
- `POST /api/after-sales/:id/cancel`：用户取消售后，仅 `submitted` / `reviewing` 可取消。

### 后台侧

- `GET /api/admin/after-sales`：售后列表，支持 `status` / `type` / `responsibility` / `order_id` / `group_buy_id` / `product_id` 过滤。
- `GET /api/admin/after-sales/:id`：售后详情。
- `POST /api/admin/after-sales/:id/review`：后台审核，可流转到 `reviewing` / `approved` / `rejected`。
- `POST /api/admin/after-sales/:id/resolve`：后台解决，退款类处理复用现有 mock 退款流程。
- `POST /api/admin/after-sales/:id/add-note`：追加后台备注，不改变状态。
- `POST /api/admin/after-sales/:id/link-loss`：将售后问题关联商品级或批次级库存损耗。

## 状态机

售后工单支持以下状态：

- `submitted`：用户已提交。
- `reviewing`：后台处理中。
- `approved`：审核通过。
- `rejected`：审核拒绝。
- `processing`：解决处理中。
- `resolved`：已解决。
- `closed`：已关闭。
- `cancelled`：用户取消。

取消规则：仅 `submitted` / `reviewing` 可取消；`approved` / `resolved` / `rejected` 等状态不可由用户取消。

## 退款接入说明

售后处理结果为 `refund` 或 `partial_refund` 时，服务层调用现有 `createMockRefund`，由现有退款服务完成退款单创建、退款成功处理、订单退款状态更新和相关日志写入。L15 不直接手动修改退款状态、订单退款金额或开团服务奖励金额。

## 库存损耗接入说明

售后可通过 `link-loss` 关联库存损耗：

- 带 `batch_id` 时复用批次损耗逻辑，写入批次损耗和批次流水。
- 不带 `batch_id` 时写入商品级 `InventoryLoss`，扣减商品基础库存并写入 `StockLedger`。
- 本阶段不做订单到批次的 FIFO 分摊。

## 业务日志与 AI context

售后服务为关键动作写入 `BusinessEventLog` 与订单时间线，事件包括：

- `after_sale_submitted`
- `after_sale_cancelled`
- `after_sale_reviewed`
- `after_sale_approved`
- `after_sale_rejected`
- `after_sale_resolved`
- `after_sale_refund_created`
- `after_sale_loss_linked`
- `after_sale_note_added`

这些事件均携带 `order_id`，因此 `/api/admin/logs/orders/:orderId/ai-context` 能聚合到对应订单的售后上下文。

## 合规边界

L15 仅处理订单售后客服问题，不改变开团服务奖励规则。开团服务奖励仍只来自开团人本人发起团购下的真实有效商品成交；退款后继续通过现有退款与佣金重算逻辑处理。提现仍保持后台人工审核、税务复核和手动标记处理，不做真实打款，不做自动报税，也不新增营销抵扣、用户等级或营销补偿券。

## 验收命令

```bash
pnpm db:generate
pnpm typecheck
pnpm test
pnpm exec tsx scripts/verify-l15-after-sale-local.ts
pnpm verify:all
```
