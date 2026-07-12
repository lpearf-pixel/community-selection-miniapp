# L40 Admin 订单详情增强 / 售后审核工作台

## 范围

- 已读取 `docs/plans/next-stage-development-plan.md`。
- 本 PR 只实现 L40。
- Admin 订单详情增强。
- 售后审核工作台。
- L39 退款拆分复用。

## 权限、安全与边界

- `GET /api/admin/orders/:id` 使用 `order.view`。
- 售后列表、详情使用 `after_sale.manage`。
- 售后审核使用 `after_sale.manage` 或 `refund.manage`。
- 保留 Admin data scope。
- 手机号和地址默认脱敏。
- 不接真实退款，不自动退款，不自动打款，不自动报税。

## Docker E2E 身份夹具修复

- `scripts/lib/docker-e2e-fixtures.ts` 通过 `prisma.adminUser.upsert` 确保 `docker-e2e-admin` 可重复创建，数据库重建后首次 Docker E2E 会自动补齐管理员。
- 售后审核与解决写入 `reviewed_by_admin_id` / `resolved_by_admin_id` 前统一校验管理员存在且 `status=active`，避免 Prisma 外键错误直接暴露为接口响应。
- Docker E2E 覆盖缺失管理员、停用管理员、审核人 ID、处理人 ID 与不再出现 FK constraint violated 的路径。
