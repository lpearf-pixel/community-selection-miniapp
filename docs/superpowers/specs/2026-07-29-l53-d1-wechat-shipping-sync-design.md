# L53-D1 微信发货信息同步设计

**基线：** `codex/l53-first-launch-closure` / PR #119

## 目标

在不改变本地履约事实源的前提下，把首次上线范围内的门店配送和到店自提结果可靠同步到微信小程序发货信息管理。

## 已批准触发边界

- 门店配送：仅订单首次从非 `delivering` 进入 `delivering` 时创建同步意图。
- 到店自提：仅自提核销命令成功把订单写为 `picked` 时创建同步意图。
- 配送进入 `delivered`、异常恢复、订单完成或管理员重复提交均不创建第二条意图。

## 所有权与事务

`Order` 继续作为唯一履约事实源。微信状态不反向改写订单状态。

本地状态变更和 `WechatShippingIntent` 在同一个 PostgreSQL 事务内提交：

- 状态事务回滚时，意图也回滚；
- 意图唯一键为 `order_id`，重复状态命令或核销回放复用同一记录；
- 微信网络调用绝不发生在管理员请求事务内。

## 微信负载

- 订单标识只使用已成功支付记录的真实 `transaction_id`，不使用 MOCK 单号，不伪造支付单号。
- 付款人使用订单所属用户的真实 `openid`。
- `delivery_mode=1`，表示统一发货。
- 门店配送映射为 `logistics_type=2`（同城配送）。
- 到店自提映射为 `logistics_type=4`（用户自提）。
- 首发不提交快递公司或物流单号。
- 商品描述从订单商品名称生成，去除控制字符并限制长度。
- 生产日志、错误记录和后台 DTO 不保存或返回 access token、app secret、完整 openid。

缺少真实 `transaction_id`、openid 或商品描述时不外呼，意图进入 `manual_required`，由后台显示原因。

## 可靠执行

API 进程内每分钟运行一次批处理，并使用 PostgreSQL 事务级 advisory lock，避免多实例重复扫描。单批最多 20 条：

- `pending` 或到达 `next_retry_at` 的 `retryable` 记录可领取；
- 调用前将状态写为 `processing` 并增加尝试次数；
- 微信成功后写为 `succeeded`，记录 `succeeded_at`，终态不再重试；
- 网络错误、超时、HTTP 429、HTTP 5xx 和微信系统繁忙类错误写为 `retryable`；
- 参数错误、权限错误、支付单不存在、缺少本地真实标识写为 `manual_required`；
- 指数退避为 1、2、4、8、16、30 分钟封顶；
- 微信失败只更新同步意图和运维告警，不回滚本地配送或核销。

微信 `access_token` 使用现有 `WECHAT_APP_ID`、`WECHAT_APP_SECRET` 获取，仅保存在进程内并在过期前刷新，不写数据库、不写日志。

## 后台

订单列表/详情只暴露以下非敏感字段：

- `shipping_sync_status`：`not_applicable | pending | processing | retryable | succeeded | manual_required`；
- `shipping_sync_attempts`；
- `shipping_sync_last_error_code`；
- `shipping_sync_next_retry_at`；
- `shipping_sync_succeeded_at`。

具备 `order.manage` 权限的管理员可对 `retryable` 或 `manual_required` 记录执行人工重试。人工重试只把原意图恢复为 `pending`，不创建新记录，不直接调用微信。

## 首发排除项

- 拆单、多包裹、快递公司和物流轨迹；
- 修改已经成功上传的发货信息；
- 微信确认收货回调；
- 用户端触发同步；
- MQ、Redis、微服务或第二套履约状态机。

## 验收

- 纯策略测试覆盖触发映射、负载脱敏、错误分类和退避。
- PostgreSQL 集成测试覆盖两条事务内触发、回滚、并发幂等和 MOCK 支付不外呼。
- worker 测试覆盖成功、可重试、人工处理和成功终态。
- 后台测试覆盖非敏感状态展示和权限受控人工重试。
- 相关 lint、API/Admin typecheck 与 focused tests 通过；完整容器门禁留到 L53 总收口。
