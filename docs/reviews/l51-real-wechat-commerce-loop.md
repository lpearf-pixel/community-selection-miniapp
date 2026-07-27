# L51 真实微信购买与拼团上线闭环

## 范围

L51 将用户身份、JSAPI 支付、退款、回调、主动对账和团购到期处理收敛到现有 Fastify + Prisma 单体架构。未引入 POS、促销权益体系、秒杀、多级奖励、Redis、MQ、微服务或生产密钥。

## 安全边界

- 小程序通过 `wx.login` 换取服务端会话，业务请求只携带 Bearer token。
- 下单、支付金额和 openid 均由服务端会话与数据库决定。
- 微信 API 请求使用 RSA-SHA256，API 响应与通知均校验平台序列号、时间窗、签名和原始字节。
- 通知按 `notification_id + body_sha256` 幂等；不保存原始或解密后的完整通知。
- 支付与退款成功只通过既有 L50 写入所有者执行订单、库存、奖励和审计投影。

## 可靠性

- Payment 使用稳定商户单号与递增 attempt，未过期 prepay 可复用。
- Refund 使用 `client_refund_id` 作为业务幂等键；同键不同订单或金额冲突。
- 后台每分钟以 PostgreSQL advisory lock 运行有界对账与团购到期扫描。
- 团购到期先查询未决支付，再判定成团或失败；失败退款键固定为 `group-failed:<group>:<order>`。
- OpsAlertLog 通过 `dedupe_key` upsert，重复扫描不产生告警风暴。

## 验证证据

- API 聚焦单元测试覆盖会话、支付签名、通知、退款、对账、到期扫描和告警去重。
- 小程序测试覆盖一次登录、真实/Mock 运行模式、`wx.requestPayment`、取消支付和后端状态轮询。
- `pnpm verify:l51` 检查必要模型、路由、客户端安全边界以及临时恢复工作流删除状态。
- PostgreSQL 集成、production build 与全量门禁由 community Runner 在 Draft PR #117 上执行。
