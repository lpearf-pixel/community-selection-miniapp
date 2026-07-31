# L53-D1 微信发货信息同步验证记录

## 范围

- 门店配送首次进入 `delivering` 时写入微信发货同步意图。
- 到店自提核销写入用户自提同步意图。
- 同步意图与本地履约状态使用同一个 PostgreSQL 事务。
- worker 使用真实 `Payment.transaction_id`、订单用户 openid 和商品描述调用微信。
- 微信失败不回滚本地履约；可重试错误指数退避，确定性错误转人工处理。
- Admin 展示非敏感同步摘要，并可把原失败意图重新加入队列。

## 本地验证

- API focused：11 个文件、104 项测试通过。
- Admin focused：3 个文件、6 项测试通过。
- API TypeScript：通过。
- Admin TypeScript：通过。
- Prisma schema：通过。
- migration safety scan：29 个迁移通过。
- lightweight lint：2 项测试与 lint 执行通过。

本地环境没有 PostgreSQL 服务，因此没有把数据库集成伪装为已完成。

## Runner PostgreSQL 验证

现有 focused gate 已加入：

- `admin-delivery-status-executor.integration.test.ts`；
- `admin-pickup-verification-executor.integration.test.ts`；
- `admin-wechat-shipping-retry.integration.test.ts`。

它们分别验证配送触发、自提触发、单订单幂等、审计原子性、数据范围和事务回滚。远端运行完成前，本记录不宣称 PostgreSQL 验证通过。

## 安全检查

- 数据库意图不保存 access token、app secret、openid 或支付单号。
- Admin DTO 不返回 access token、openid 或 `transaction_id`。
- OpsAlert 只记录意图 ID、稳定错误码、状态和尝试次数。
- MOCK 或缺少真实微信支付单号时不调用微信。
- 人工重试路由只重新排队，不直接调用微信。

## 首发排除

- 拆单、多包裹、快递物流轨迹；
- 修改已成功上传的发货信息；
- 微信确认收货回调；
- 用户端触发同步；
- MQ、Redis、微服务和第二套履约状态机。
