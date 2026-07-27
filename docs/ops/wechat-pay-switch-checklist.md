# WECHAT_PAY_MODE 从 mock 切到 wechat 的人工 Checklist

## 切换前

1. 确认 `WECHAT_PAY_MODE=wechat`、`MOCK_WECHAT_PAY=false`。
2. 确认 AppID、商户号、商户证书序列号、平台证书序列号和 API v3 密钥与微信商户平台一致。
3. 确认 `WECHAT_PRIVATE_KEY_PATH` 与 `WECHAT_PLATFORM_CERT_PATH` 指向只读受控文件，源码、镜像层和日志中均不含私钥或密钥。
4. 确认支付和退款通知地址均为公网 HTTPS，路径分别为 `/api/payments/wechat/notify` 与 `/api/refunds/wechat/notify`。
5. 执行 `pnpm verify:l51`、数据库迁移检查、API 类型检查和 production build。
6. 确认后台任务只有 advisory-lock 持有者执行，对账与团购到期扫描可写入 `OpsAlertLog`。

## 0.01 元验收

1. 使用内部体验账号创建 0.01 元普通购买订单，核对客户端请求不含 user_id、openid 或金额字段。
2. 核对 JSAPI 初始化的金额和 openid 均来自数据库，随后完成 `wx.requestPayment`。
3. 核对支付回调返回 204；Payment、Order、库存、时间线和奖励投影只执行一次。
4. 重放同一回调，确认返回成功且不重复投影；修改报文后重放必须失败并产生告警。
5. 发起 0.01 元退款，核对退款意图、微信受理、退款通知与库存/奖励回滚只执行一次。
6. 模拟丢失回调，确认后台主动查单可把支付或退款收敛到成功。
7. 建立一个到期未成团样本，确认先查未决支付，再关闭未支付订单，并使用稳定业务键发起退款。

## 观察与回退

1. 切换后持续观察 Payment、Refund、Order、BusinessEventLog、OrderTimelineLog 和 OpsAlertLog。
2. 若签名、金额、openid、商户号或平台证书校验异常，停止新流量并保留证据，不得人工把订单改为已支付。
3. 应用回退时先切换流量到上一稳定版本；`mock` 只允许内部非生产环境使用，不得用它代替生产故障恢复。
4. 数据库迁移为向前兼容变更；回退应用前保留新增表和字段，禁止直接回滚已产生的支付/退款数据。
