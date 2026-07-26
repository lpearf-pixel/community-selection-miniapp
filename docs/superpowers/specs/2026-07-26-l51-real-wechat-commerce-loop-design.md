# L51 真实微信购买与拼团上线闭环设计

## 1. 目标

在现有订单、库存、团购、退款、开团服务奖励和财务治理基础上，完成可上线的微信小程序真实交易闭环：

1. 用户通过微信小程序登录，服务端建立不可伪造的用户会话。
2. 普通购买与参团订单通过微信支付 API v3 JSAPI 下单。
3. 小程序调用 `wx.requestPayment`，订单最终状态只以后端支付通知或主动查单为准。
4. 支付通知可靠落账，驱动库存、团购进度和开团服务奖励。
5. 团购到期时自动关闭未支付订单；未成团的已支付订单自动发起微信退款。
6. 退款成功通知可靠落账，统一回补库存、退还消费抵扣并取消或调整开团服务奖励。
7. 生产配置、重放防护、对账和告警具备 fail-closed 能力。

上线验收以真实小程序、真实商户号和真实 0.01 元订单为准。商户密钥、证书和用户凭据不得进入仓库。

## 2. 范围

### 2.1 本期包含

- 微信 `code2session` 登录。
- 服务端会话令牌及会话吊销/过期。
- 微信支付 v3 请求签名、JSAPI 下单和小程序调起支付签名。
- 支付通知验签、AES-256-GCM 解密、金额/商户/用户校验和幂等落账。
- 微信关单、商户订单号查单。
- 微信退款申请、退款查单和退款结果通知。
- 团购到期可重入扫描、延迟支付校准、自动失败退款和闭环关闭。
- PostgreSQL 单实例调度锁、支付/退款对账及异常告警。
- 小程序真实支付接线、生产 API 地址和开发 MOCK 隔离。
- 单元、合同、PostgreSQL 并发、回调重放、小程序自动化及真实小额验收清单。

### 2.2 本期不包含

- POS、线下收银机同步。
- 自动提现、自动报税、分账或多级奖励。
- 优惠券、秒杀、会员营销等新产品能力。
- Redis、MQ、微服务、Kubernetes。
- 自动售后审核；既有人工售后审核继续保留。
- 把微信密钥、证书内容或真实通知报文写入数据库、日志、测试夹具或 Git。

## 3. 外部协议基线

实现以微信官方当前文档为准：

- 小程序登录：`GET https://api.weixin.qq.com/sns/jscode2session`。
- JSAPI/小程序下单：`POST https://api.mch.weixin.qq.com/v3/pay/transactions/jsapi`。
- 商户订单号查单：`GET /v3/pay/transactions/out-trade-no/{out_trade_no}`。
- 关单：`POST /v3/pay/transactions/out-trade-no/{out_trade_no}/close`。
- 退款申请：`POST /v3/refund/domestic/refunds`。
- 商户退款单号查退款：`GET /v3/refund/domestic/refunds/{out_refund_no}`。
- 支付与退款通知：使用未经 JSON 重序列化的原始请求体、`Wechatpay-Timestamp`、`Wechatpay-Nonce`、`Wechatpay-Serial` 和 `Wechatpay-Signature` 验签；验签通过后使用 APIv3 密钥解密 `resource`。

前端 `wx.requestPayment` 返回成功只表示收银台交互完成，不得直接把本地订单标记为已支付。

## 4. 总体架构

保持单体 Fastify + PostgreSQL。新增模块按单一所有权拆分：

| 模块 | 职责 | 不允许做的事 |
|---|---|---|
| `wechat-login-client` | 调用 `code2session`，校验微信响应 | 创建业务用户或签发会话 |
| `user-session-owner` | 用户 upsert、会话令牌哈希、过期与吊销 | 信任客户端 openid/user_id |
| `wechat-pay-v3-client` | API v3 请求签名、HTTP、响应解析、查单/关单/退款 | 修改业务数据库 |
| `wechat-notify-verifier` | 原始报文验签、时间窗检查、AES-GCM 解密 | 变更订单、支付或退款 |
| `payment-command` | 创建/复用预支付、支付成功投影、支付查询校准 | 接收客户端提供的 openid 或金额 |
| `refund-command` | 创建退款意图、提交微信退款、退款成功投影 | 在微信确认前标记退款成功 |
| `group-expiry-command` | 团购截止校准、关单、判定失败、创建退款意图 | 绕过支付/退款 owner 直接改财务状态 |
| `wechat-reconciler` | 扫描不确定状态、主动查单/查退款、告警 | 在无 PostgreSQL 调度锁时并发执行 |

路由只负责严格解析、身份校验、调用命令和映射响应，不保留跨域写链。

## 5. 数据模型

### 5.1 `UserSession`

新增：

- `id`
- `user_id`
- `token_hash`，唯一；只存 SHA-256/HMAC 后的摘要
- `expires_at`
- `revoked_at`
- `last_seen_at`
- `created_at`

服务端生成至少 32 字节随机令牌，使用 `USER_SESSION_TOKEN_SECRET` 计算 HMAC-SHA-256 后落库，客户端只持有明文。默认有效期 30 天；每次认证仅节流更新 `last_seen_at`，不会在日志中输出令牌。

### 5.2 `WechatNotificationReceipt`

新增：

- `id`
- `notification_id`，唯一
- `notification_type`：`payment` 或 `refund`
- `event_type`
- `resource_identifier`：支付 `out_trade_no` 或退款 `out_refund_no`
- `body_sha256`
- `status`：`processing`、`applied`、`ignored`、`failed`
- `failure_code`
- `processed_at`
- `created_at`
- `updated_at`

该表只保存通知元数据和摘要，不保存完整原始通知、openid、手机号、地址、密文或密钥。

同一 `notification_id`：

- 相同 `body_sha256` 重放返回成功，不重复执行业务投影。
- 不同 `body_sha256` 返回失败并产生高等级告警。

### 5.3 `Payment` 扩展

复用现有 `out_trade_no`、`transaction_id`、`prepay_id`、金额和状态，新增：

- `attempt_no`，同订单从 1 递增；`order_id + attempt_no` 唯一
- `prepay_expires_at`
- `provider_success_at`
- `last_reconciled_at`
- `reconcile_attempts`
- `last_provider_error_code`

`out_trade_no` 继续唯一且必须满足微信 6–32 字符规则。新尝试使用稳定的订单引用和 `attempt_no` 生成，不使用时间戳随机碰撞。

### 5.4 `Refund` 扩展

复用现有 `out_refund_no`、`refund_id`、金额拆分和状态，新增：

- `provider_status`
- `last_reconciled_at`
- `reconcile_attempts`
- `last_provider_error_code`

现有 `client_refund_id` 继续作为业务幂等键；同键不同订单或金额返回 `409`。

### 5.5 `OpsAlertLog` 扩展

新增可空且唯一的 `dedupe_key`。支付、退款和团购对账告警必须按稳定的 `alert_type + target_id + provider_state` 生成去重键并 upsert；人工关闭旧告警后，只有 provider 状态发生变化或明确进入新的告警周期才生成新告警。

## 6. 登录与用户会话

### 6.1 登录接口

新增 `POST /api/auth/wechat/login`：

```json
{
  "code": "wx.login 返回的一次性 code"
}
```

处理顺序：

1. 严格拒绝未知字段、空 code 和超长 code。
2. 服务端使用 `WECHAT_APP_ID`、`WECHAT_APP_SECRET` 调用 `code2session`。
3. 微信返回错误、缺少 openid 或请求超时均不创建会话。
4. 按 openid upsert 用户；已有用户的角色、状态和资料不得被登录请求覆盖。
5. 停用用户返回 `403`。
6. 签发随机会话令牌，返回安全用户信息和 `expires_at`。

`session_key` 仅在当前调用内使用，不落库、不记录日志、不返回客户端。

### 6.2 认证边界

- 小程序请求使用 `Authorization: Bearer <token>`。
- 生产环境完全拒绝 `x-user-id`、`x-openid`。
- 非生产环境只有在 `CURRENT_USER_MOCK_HEADERS_ENABLED=true` 时才允许旧测试头。
- 所有下单、查订单、支付初始化、开团人接口都从会话解析 `user_id/openid`。
- 客户端提交的 `user_id`、`user_openid`、`leader_user_id`、`leader_openid` 均视为未知字段并拒绝。

小程序启动时调用 `wx.login`，换取并缓存会话；遇到 `401` 只允许自动重登一次，防止无限循环。

## 7. JSAPI 支付

### 7.1 初始化接口

`POST /api/payments/wechat/jsapi` 请求体只允许：

```json
{
  "order_id": "..."
}
```

服务端必须验证：

- 当前会话用户拥有订单。
- 订单仍未支付、未关闭、未退款。
- 普通订单仍在支付时限内；团购订单未超过 `end_time`。
- 金额使用数据库 `pay_amount_cents`，openid 使用会话用户数据库值。

命令先锁订单和支付记录，生成稳定 `out_trade_no`。有效 `prepay_id` 可复用；过期预支付必须先查单/关单后再使用新的商户订单号，不可覆盖一个已被微信接受的商户订单号。

调用微信时提交：

- 仓库配置的 appid、mchid 和 notify_url。
- 数据库订单描述、金额、openid、客户端 IP。
- `time_expire`：团购单不晚于团购截止时间，普通订单使用配置的支付窗口。
- `attach` 只放不敏感的订单引用。

微信返回 `prepay_id` 后，服务端使用商户私钥签名并返回小程序所需的：

```json
{
  "timeStamp": "...",
  "nonceStr": "...",
  "package": "prepay_id=...",
  "signType": "RSA",
  "paySign": "..."
}
```

### 7.2 小程序交互

- 生产模式调用 JSAPI 初始化接口后执行 `wx.requestPayment`。
- 用户取消支付时保留未支付订单，展示“支付已取消”，允许在有效期内重试。
- `wx.requestPayment` 返回成功后轮询当前用户订单详情，直到后端确认 `pay_status=paid`，或进入明确超时状态。
- MOCK 支付仅在开发构建且 `GET /api/public/runtime` 返回 `payment_mode=mock` 时可用；生产包中不可出现自动调用 `/api/payments/mock` 的分支。

## 8. 支付通知与主动查单

### 8.1 通知入口

`POST /api/payments/wechat/notify`：

1. 使用原始请求体和四个 `Wechatpay-*` 头验签。
2. `Wechatpay-Serial` 必须精确匹配配置的微信支付平台证书序列号，并使用该平台证书验签。
3. 拒绝签名探测流量、签名错误、与服务器时间相差超过 5 分钟的时间戳、未知算法和解密失败。
4. 解密后校验 `event_type=TRANSACTION.SUCCESS`、appid、mchid、交易类型、币种、金额、`out_trade_no`、`transaction_id` 和 payer openid。
5. 在一个数据库事务中创建通知回执、锁定 Payment/Order、执行支付成功投影、完成回执。
6. 事务成功返回 `204`；校验失败返回 `4xx`；瞬时数据库错误返回 `5xx` 以便微信重试。

支付成功投影继续统一驱动：

- Payment 成功状态。
- Order 支付状态和时间。
- 库存扣减。
- 团购进度与成团状态。
- 订单时间线、业务事件和审计。
- 仅对有效团购订单生成一级开团服务奖励。

### 8.2 截止时间与延迟通知

以微信 `success_time` 判断付款发生时间：

- `success_time <= group_buy.end_time`：作为有效参团付款。
- 截止后才成功或团购已经可靠判定失败：记录真实收款，但不得计入成团和奖励，立即创建全额退款意图并产生告警。

### 8.3 主动查单

以下情况调用商户订单号查单：

- 小程序支付交互成功，但本地在短轮询后仍未支付。
- Payment 长时间处于 `created/prepay`。
- 团购到期关闭前。
- 回调处理结果不确定。

查询到 `SUCCESS` 时复用同一支付成功执行器；查询到 `CLOSED/REVOKED/PAYERROR` 时安全关闭本地未支付状态。不得以小程序前端结果代替查单。

## 9. 微信退款

### 9.1 创建退款意图

新增内部可靠命令，不开放匿名“微信退款申请”路由：

1. 锁定 Order，验证已支付、可退余额、订单版本和金额拆分。
2. 按 `client_refund_id` 查找并严格比较原命令。
3. 创建 `Refund(status=pending)` 与审计/业务事件后提交事务。
4. 事务外调用微信退款申请；超时或网络未知结果不得创建第二退款单，后续按 `out_refund_no` 查退款。
5. 微信受理后把本地状态更新为 `processing`。

团购失败使用固定业务键 `group-failed:<group_buy_id>:<order_id>`，保证扫描重试只产生一张退款单。

### 9.2 退款通知

`POST /api/refunds/wechat/notify` 使用与支付通知相同的验签、时间窗、解密和回执机制，并验证：

- mchid。
- `out_refund_no`、`refund_id`。
- `amount.total` 等于原支付金额。
- `amount.refund` 等于本地退款金额。
- 币种为 CNY。

只有微信状态 `SUCCESS` 才调用统一退款成功投影。`CLOSED`、`ABNORMAL` 等状态只更新 provider 状态并产生告警，不得回补库存或取消奖励。

退款成功投影继续统一驱动：

- Refund 成功及处理时间。
- Order 累计退款金额、拆分金额、退款/订单状态。
- 满足既有策略时回补库存。
- 全额退款时退还消费抵扣。
- 调整或取消开团服务奖励。
- 时间线、业务事件与审计。

重复通知、通知与主动查退款竞争时，只允许一次首次成功投影。

## 10. 团购到期自动闭环

每分钟执行一次可重入扫描；多实例通过 PostgreSQL advisory lock 保证同一时刻只有一个 worker。

对每个到期 `pending` 团购：

1. 锁定团购，读取所有订单和 Payment。
2. 对存在预支付但本地未支付的订单主动查单。
3. 对仍未支付的微信订单调用关单；若关单返回“已支付”，立即查单并走支付成功执行器。
4. 重新计算有效已支付人数/份数。
5. 达标则原子标记 `success` 并把有效订单转为 `grouped`。
6. 未达标则原子标记 `failed`，本地关闭已确认未支付订单。
7. 为每张已支付且仍有可退余额的订单创建全额退款意图。
8. 事务提交后逐张提交微信退款；失败保留可重试状态并告警。
9. 所有退款成功、库存回补完成且无异常订单后，将团购标记 `closed`。

扫描进程崩溃、网络超时、重复执行或多实例竞争都不得重复扣库存、重复创建退款、重复取消奖励或提前关闭团购。

## 11. 对账与告警

不引入 Redis/MQ。调度器复用 PostgreSQL advisory lock，并处理：

- 超过阈值仍未确认的 Payment：主动查单。
- `pending/processing` Refund：主动查退款。
- 已失败但仍有待退款订单的 GroupBuy：继续提交/查询退款。
- 通知 ID 碰撞、金额不一致、商户/appid/openid 不一致。
- 退款异常、连续对账失败、支付成功但本地投影失败。

告警写入现有 `OpsAlertLog`，使用稳定 `alert_type + target` 幂等键，避免每分钟重复告警。日志只记录内部 ID、微信错误码、请求追踪 ID 和脱敏元数据。

## 12. 配置与密钥

真实模式启动必须完整校验：

- `WECHAT_APP_ID`
- `WECHAT_APP_SECRET`
- `WECHAT_MCH_ID`
- `WECHAT_MCH_SERIAL_NO`
- `WECHAT_PRIVATE_KEY_PATH`
- `WECHAT_API_V3_KEY`
- `WECHAT_PAY_PLATFORM_SERIAL_NO`
- `WECHAT_PAY_PLATFORM_CERT_PATH`
- `WECHAT_PAY_NOTIFY_URL`
- `WECHAT_REFUND_NOTIFY_URL`
- `MINIAPP_API_BASE_URL`
- `USER_SESSION_TOKEN_SECRET`

要求：

- 私钥、平台证书/公钥和密钥从部署环境或只读挂载文件注入。
- 真实模式下通知地址和 API 地址必须是 HTTPS，且不得为 localhost、回环或私网地址。
- APIv3 密钥必须满足微信长度要求；密钥文件启动时必须可读。
- 小程序生产构建从环境生成非 localhost 配置，并加入微信公众平台 request 合法域名。
- `MOCK_WECHAT_PAY=true` 与生产环境互斥；生产出现 MOCK 路由调用立即失败并告警。
- 真实密钥不得出现在异常消息、健康检查响应和配置摘要中。

## 13. 错误处理

- 微信登录、支付和退款 HTTP 客户端设置明确连接/响应超时，不无限重试。
- 对确定性 `4xx` 不自动重试；对网络超时/`5xx` 转入主动查询确认状态。
- 外部调用与数据库事务分离，用稳定商户单号消除“双写”不确定性。
- 回调业务处理未提交时不得返回成功。
- 所有用户可见错误使用稳定错误码和安全中文说明；微信原始响应只进入脱敏日志。
- 金额、身份、商户号、通知签名任一不一致均 fail closed，不修改订单。

## 14. API 合同变更

新增：

- `GET /api/public/runtime`，只返回 `payment_mode` 和非敏感版本标识
- `POST /api/auth/wechat/login`
- `POST /api/auth/logout`
- `POST /api/payments/wechat/jsapi`
- `GET /api/me/orders/:id/payment-status`
- `POST /api/payments/wechat/notify`
- `POST /api/refunds/wechat/notify`
- 内部调度入口或进程内 scheduler，不提供匿名管理操作。

收紧：

- 下单和开团接口不再接受客户端身份字段。
- 当前用户接口只接受 Bearer 会话。
- `/api/payments/mock`、`/api/refunds/mock` 仅在明确非生产 MOCK 模式注册。

既有响应外壳 `{ success, data, message }` 继续用于业务 API；微信通知成功使用微信要求的空 `204` 响应，失败使用微信要求的错误格式，不套业务响应外壳。

## 15. 测试与验收

### 15.1 单元与合同

- API v3 请求签名、JSAPI 调起支付签名。
- 回调原始体验签、错误证书序列号、过期时间戳、签名探测和 AES-GCM 解密。
- `code2session` 错误映射与会话令牌哈希。
- 严格身份、金额、appid/mchid/openid 校验。
- MOCK/真实模式注册边界和生产配置 fail closed。

测试使用仓库内专用测试密钥；不得使用真实商户材料。

### 15.2 PostgreSQL 集成

- 同订单并发初始化支付只产生一条有效 Payment。
- 支付通知重复、乱序及主动查单竞争只扣一次库存、只生成一次奖励。
- 相同通知 ID 不同请求体被拒绝并告警。
- 团购最后一笔支付与到期扫描竞争，最终只能成功成团或失败退款，不得两者同时发生。
- 失败团购重复扫描只生成一张/单退款。
- 退款通知重复、主动查退款竞争只回补一次库存、只调整一次奖励。
- 任一步骤注入异常时整笔本地事务回滚，外部不确定状态由对账恢复。

### 15.3 小程序与 Runner

- 普通购买：登录、下单、支付、支付确认、订单可见。
- 参团成团：两名独立用户支付，团购成功，订单状态一致。
- 用户取消支付：订单保持未支付，可重试。
- 过期未成团：未支付订单关闭，已支付订单进入退款并最终成功。
- 生产构建中无 localhost、伪造 openid 头或自动 MOCK 支付。
- `lint`、`typecheck`、API/Admin/小程序测试、生产构建和完整 `verify:all` 通过。

### 15.4 真实上线小额验收

在预发布环境使用真实商户配置：

1. 真实微信用户登录。
2. 创建并支付一笔 0.01 元普通订单。
3. 验证微信支付回调、订单状态、库存和后台台账。
4. 对该订单发起 0.01 元退款，验证退款通知、库存和奖励投影。
5. 使用两个测试用户完成 0.01 元参团成团。
6. 创建一个短时限未成团订单，验证自动关闭与退款。
7. 暂停一次回调接收，验证主动查单/查退款可以恢复状态。

真实验收产生的订单、退款和测试商品必须带明确测试标记，并在验收后归档。

## 16. 完成条件

以下条件全部满足才可宣称“购买、拼团可真实上线”：

- 生产用户身份不再信任客户端 openid/user_id。
- JSAPI 下单和 `wx.requestPayment` 已真实接通。
- 支付/退款通知不再返回 501，且验签、解密、金额校验和幂等完整。
- 普通购买与参团订单都只由可信支付结果落账。
- 团购到期自动关单、失败退款和最终关闭可重入。
- 对账与告警能恢复回调遗漏和外部调用不确定状态。
- 生产域名与密钥配置 fail closed，仓库无真实秘密。
- 自动门禁全部通过。
- 真实 0.01 元普通购买、退款、成团和失败团退款验收通过。

## 17. 官方参考

- [微信支付 JSAPI/小程序下单](https://pay.wechatpay.cn/doc/v3/merchant/4012791856)
- [微信支付 JSAPI 调起支付](https://pay.wechatpay.cn/doc/v3/merchant/4012791857)
- [微信支付成功回调通知](https://pay.wechatpay.cn/doc/v3/merchant/4012791861)
- [微信支付退款申请](https://pay.wechatpay.cn/doc/v3/merchant/4012791862)
- [微信支付查询退款](https://pay.wechatpay.cn/doc/v3/merchant/4012791863)
- [微信支付退款结果通知](https://pay.wechatpay.cn/doc/v3/merchant/4012791865)
- [微信小程序 code2Session](https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/user-login/code2Session.html)
