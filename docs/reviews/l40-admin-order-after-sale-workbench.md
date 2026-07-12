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

## 报告质量修复

- L40 报告 manifest 使用结构化 checklist：每项必须包含非空 `text` 与布尔 `passed`，避免渲染为 `[ ] undefined`。
- 阶段验证结果优先解析实际 stage workflow marker：L40 verifier、L24-L40 chain regression、Docker API E2E、Admin typecheck config、Admin full typecheck、raw compliance scan 与 Stage workflow。
- 未完成项扫描仅识别明确 TODO / FIXME / TBD / NOT_IMPLEMENTED / Not implemented 类标记，不把 UI `placeholder` 属性或 Docker E2E 测试 fixture 字符串当作未完成业务项。
- API 权限在报告中按路由展示 `order.view` 与 `after_sale.manage`，不再使用笼统的 L40 admin permission。

- Admin full typecheck 现在优先识别 `Admin typecheck passed.`；兼容旧日志中 `=== Running Admin typecheck ===` 且段落内无 TS/PNPM/模块错误并最终 `Stage workflow verification passed.` 的零输出成功场景。
- L40 报告第 1 节明确区分业务稳定分支/commit 与报告生成分支/commit。
- 售后审核接口权限完整展示 `after_sale.manage + refund.manage`，避免只取权限数组第一项。
