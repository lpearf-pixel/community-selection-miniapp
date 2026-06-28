# 04 API 接口规范

所有接口返回统一格式。

成功：

```json
{
  "success": true,
  "data": {},
  "message": ""
}
```

失败：

```json
{
  "success": false,
  "data": null,
  "message": "错误原因"
}
```

## 健康检查

```text
GET /health
```

## 用户认证

```text
POST /api/auth/wx-login
GET  /api/me
POST /api/me/phone
```

MOCK 模式下，`wx-login` 可返回测试 openid。

## 商品

```text
GET /api/categories
GET /api/products
GET /api/products/:id
```

## 社区和自提点

```text
GET /api/communities
GET /api/pickup-stores
```

## 团购

```text
POST /api/group-buys
GET  /api/group-buys
GET  /api/group-buys/:id
POST /api/group-buys/:id/join
POST /api/group-buys/:id/cancel
```

规则：

- 只有 leader 可以发起开团。
- 普通用户可以参团。
- 成团统计只计算已支付订单。
- 过期未成团由定时任务处理。

## 订单

```text
POST /api/orders
GET  /api/orders
GET  /api/orders/:id
POST /api/orders/:id/cancel
POST /api/orders/:id/complete
POST /api/orders/:id/refund
```

订单创建要求：

- 使用数据库事务。
- 防止库存超卖。
- 支持 client_request_id 幂等。

## 微信支付

```text
POST /api/pay/wechat/prepay
POST /api/pay/wechat/notify
GET  /api/pay/orders/:id/status
POST /api/pay/mock/success
```

`POST /api/pay/mock/success` 仅当 `MOCK_WECHAT_PAY=true` 时可用。

支付成功后必须：

1. 更新 Payment。
2. 更新 Order 为 paid。
3. 刷新团购 current_people/current_quantity。
4. 判断是否成团。
5. 生成预计开团服务奖励。
6. 保证回调幂等，不能重复生成奖励。

## 退款

```text
POST /api/refunds
GET  /api/refunds/:id
POST /api/refunds/:id/audit
POST /api/refunds/mock/success
POST /api/refunds/wechat/notify
```

退款成功后必须：

1. 更新 Refund。
2. 更新 Order.refund_amount_cents。
3. 全额退款时 Order.status = refunded。
4. 部分退款时保留当前履约状态。
5. 同步扣减 Commission。
6. 保证回调幂等。

## 开团人

```text
POST /api/leaders/apply
GET  /api/leaders/me
GET  /api/leaders/me/groups
GET  /api/leaders/me/commissions
POST /api/leaders/me/withdraw
```

## 后台接口

后台使用 `ADMIN_TOKEN` 鉴权。

```text
POST /api/admin/login
GET  /api/admin/products
POST /api/admin/products
PUT  /api/admin/products/:id
PUT  /api/admin/products/:id/status
GET  /api/admin/group-buys
GET  /api/admin/group-buys/:id
GET  /api/admin/orders
GET  /api/admin/orders/:id
PUT  /api/admin/orders/:id/status
GET  /api/admin/orders/export-picking-list
GET  /api/admin/refunds
POST /api/admin/refunds/:id/approve
POST /api/admin/refunds/:id/reject
GET  /api/admin/leader-applications
POST /api/admin/leader-applications/:id/approve
POST /api/admin/leader-applications/:id/reject
GET  /api/admin/commissions
POST /api/admin/commissions/:id/freeze
POST /api/admin/commissions/:id/unfreeze
GET  /api/admin/withdrawals
POST /api/admin/withdrawals/:id/approve
POST /api/admin/withdrawals/:id/reject
POST /api/admin/withdrawals/:id/mark-paid
```

## 错误处理

常见错误码可以先用 message 描述，后续再抽象 code。

必须处理：

- 未登录
- 无权限
- 商品不存在
- 商品未上架
- 库存不足
- 团购不存在
- 团购已结束
- 订单不存在
- 重复支付通知
- 重复退款通知
- 退款金额超过可退金额
- 非 MOCK 模式禁止调用 mock 接口
