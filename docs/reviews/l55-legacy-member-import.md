# L55 历史老客手机号导入阶段 Review

## 交付结果

- CSV 与 `.xlsx` 两阶段导入：上传只生成预览，确认后才建立资格。
- 大陆手机号规范化、脱敏与 HMAC-SHA256 身份指纹。
- 5 MiB、10,000 行、Excel 第一工作表及公式单元格安全边界。
- 批次、行、`LEGACY_FIRST_YEAR_FREE` 资格三张 Prisma 表和迁移。
- 同批去重、跨批幂等、账户手机号匹配、待认领、可信手机号延迟认领、未使用资格撤销。
- 严格 `super_admin` 管理 API；响应只返回脱敏手机号，不返回完整手机号或手机号指纹。
- 后台“membership-marketing / 历史老客导入”工作台；付费权益关闭时只建立资格。
- `MEMBER_PHONE_HMAC_SECRET` 纳入统一配置、生产 Compose 与生产预检。

## 新增依赖

- `@fastify/multipart@10.1.0`
- `csv-parse@6.1.0`
- `exceljs@4.4.0`

## 验证证据

- L55 聚焦门禁：95/95 通过。
- Admin：50 个文件、173 项通过。
- API 非数据库层：94 个文件、736 项通过。
- `pnpm lint`：通过。
- `pnpm typecheck`：通过。
- `pnpm build`：通过；仅保留既有 Ant Design `use client` 与大 chunk 警告。
- Prisma schema：使用宿主机统一连接串完成静态校验。
- 迁移静态检查：30 个迁移通过。
- 生产 Compose / preflight：21/21 通过。
- `git diff --check`：通过。

## 数据库验证边界

宿主机运行测试时统一使用：

```text
postgresql://postgres:postgres@127.0.0.1:15432/community_selection?schema=public
```

Compose 内 API 使用 `postgres:5432`；生产环境使用 `DATABASE_URL` 指向内部 `postgres` 服务，不使用 `127.0.0.1`。

当前 Codex 环境没有 Docker/PostgreSQL，`127.0.0.1:15432` 无监听，因此全量测试中的 19 个既有 PostgreSQL 集成文件未完成运行时验证。代码合并前应在 Runner 启动 PostgreSQL、部署全部迁移后执行全量门禁。

## 未包含

- 88 元付费权益购买、9 折/团购 8 折计算仍保持关闭。
- 微信 `getPhoneNumber` 可信手机号绑定入口不在本阶段；本阶段已提供可复用的资格认领服务函数。
