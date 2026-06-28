# 03 数据库模型

Codex 需要基于本文件实现 `prisma/schema.prisma`。

## 枚举

```prisma
enum UserRole {
  customer
  leader
  admin
}

enum ProductStatus {
  draft
  active
  inactive
}

enum GroupBuyStatus {
  pending
  success
  failed
  cancelled
  preparing
  ready
  fulfilled
  closed
}

enum OrderStatus {
  unpaid
  paid
  grouped
  preparing
  ready
  picked
  delivered
  completed
  refunding
  refunded
  closed
}

enum PayStatus {
  unpaid
  paid
  failed
  closed
}

enum RefundStatus {
  none
  pending
  approved
  processing
  success
  failed
  rejected
}

enum CommissionStatus {
  estimated
  frozen
  pending
  available
  withdrawn
  deducted
  cancelled
}

enum CommissionType {
  none
  fixed
  percent
}

enum PickupType {
  store
  delivery
}

enum WithdrawalStatus {
  pending
  approved
  paid
  rejected
}
```

## 必须模型

### User

字段：

- id
- openid unique
- unionid optional
- nickname
- avatar_url
- phone
- role UserRole
- status
- created_at
- updated_at

### Category

- id
- name
- sort_order
- status
- created_at
- updated_at

### Product

- id
- name
- category_id
- cover_image
- images Json
- description
- price_cents Int
- cost_price_cents Int
- stock Int
- unit
- is_group_enabled Boolean
- commission_type CommissionType
- commission_value Int
- status ProductStatus
- created_at
- updated_at

说明：

- fixed 奖励时，commission_value 单位为分。
- percent 奖励时，commission_value 表示百分比整数，例如 8 表示 8%。

### Community

- id
- name
- address
- status
- created_at
- updated_at

### PickupStore

- id
- name
- address
- phone
- latitude optional
- longitude optional
- status
- created_at
- updated_at

### GroupBuy

- id
- product_id
- leader_user_id
- community_id
- min_people
- min_quantity
- current_people
- current_quantity
- price_cents
- start_time
- end_time
- pickup_time
- status GroupBuyStatus
- created_at
- updated_at

### Order

- id
- order_no unique
- client_request_id optional unique
- user_id
- group_buy_id optional
- leader_user_id optional
- total_amount_cents
- pay_amount_cents
- refund_amount_cents
- pay_status PayStatus
- order_status OrderStatus
- refund_status RefundStatus
- pickup_type PickupType
- pickup_store_id optional
- community_id optional
- receiver_name
- receiver_phone
- receiver_address optional
- created_at
- paid_at optional
- completed_at optional
- updated_at

### Payment

- id
- order_id
- out_trade_no unique
- transaction_id optional unique
- prepay_id optional
- amount_cents
- trade_state
- raw_notify Json optional
- created_at
- updated_at

### Refund

- id
- order_id
- out_refund_no unique
- refund_id optional unique
- refund_amount_cents
- reason
- status RefundStatus
- raw_notify Json optional
- created_at
- updated_at

### Commission

- id
- leader_user_id
- order_id
- group_buy_id
- base_amount_cents
- commission_type CommissionType
- commission_value Int
- estimated_amount_cents
- deduct_amount_cents
- final_amount_cents
- status CommissionStatus
- available_at optional
- created_at
- updated_at

### LeaderApplication

- id
- user_id
- real_name
- phone
- community_id optional
- status
- admin_remark optional
- created_at
- updated_at

### Withdrawal

- id
- leader_user_id
- amount_cents
- status WithdrawalStatus
- admin_remark optional
- created_at
- updated_at

### AuditLog

- id
- actor_user_id optional
- action
- target_type
- target_id optional
- payload Json optional
- created_at

## 禁止字段

任何模型中禁止出现：

- parent_leader_id
- upline_id
- team_id
- parent_id 用于开团人关系
- level 用于分销层级

## Seed 数据

需要初始化：

1. admin 用户
2. 商品分类：有机蔬菜、鸡蛋、水果、杂粮、干货
3. 10 个测试商品
4. 3 个社区
5. 1 个门店自提点

## 索引要求

- User.openid unique
- Order.order_no unique
- Order.client_request_id unique optional
- Payment.out_trade_no unique
- Payment.transaction_id unique optional
- Refund.out_refund_no unique
- Refund.refund_id unique optional
- GroupBuy.product_id index
- GroupBuy.leader_user_id index
- Order.user_id index
- Order.group_buy_id index
- Commission.leader_user_id index
