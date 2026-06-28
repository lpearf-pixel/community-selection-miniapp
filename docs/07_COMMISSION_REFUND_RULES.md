# 07 开团服务奖励与退款规则

## 命名规范

统一使用：

- 开团服务奖励
- 服务奖励
- 推广服务费

不要使用：

- 返利
- 分销
- 下级收益
- 团队收益
- 代理收益
- 躺赚
- 拉人头奖励

## 合规边界

本项目只允许一级开团服务奖励。

系统中不允许设计：

- 二级关系
- 三级关系
- 团队结构
- 上下级结构
- parent_leader_id
- upline_id
- team_id

不得收取：

- 加盟费
- 资格费
- 入门费
- 购买礼包成为开团人的费用

奖励只与开团人本人发起团购产生的真实商品成交有关。

## 奖励生成时机

支付成功后生成预计奖励：

```text
Commission.status = estimated
```

但不可提现。

## 奖励计算

### fixed

```text
奖励 = 实际成交件数 * commission_value
```

`commission_value` 单位是分。

### percent

```text
奖励 = 实际成交商品金额 * commission_value / 100
```

`commission_value` 为整数百分比，例如 8 表示 8%。

### none

不生成奖励。

## 实际成交商品金额

```text
实际成交商品金额 = 订单商品实付金额 - 已成功退款金额
```

不计入：

- 运费
- 平台优惠承担金额
- 已退款金额
- 售后赔付金额

## 状态流转

```text
estimated → pending → available → withdrawn
```

异常情况：

```text
estimated/pending → frozen
estimated/pending/available → deducted
estimated/pending → cancelled
```

## T+7 结算

订单完成后进入待结算：

```text
Order.status = completed
Commission.status = pending
Commission.available_at = completed_at + 7 days
```

每天凌晨定时任务扫描：

- status = pending
- available_at <= now
- 无退款中
- 未冻结

满足条件后：

```text
Commission.status = available
```

## 退款扣减规则

### 未成团退款

- 订单退款
- 奖励取消

```text
Commission.status = cancelled
final_amount_cents = 0
```

### 全额退款

- 订单状态 refunded
- 奖励取消或扣减为 0

### 部分退款

重新计算奖励：

```text
new_base = old_base - refund_amount
new_commission = recalculate(new_base)
deduct_amount = old_final - new_commission
final_amount = new_commission
```

### 异常订单

后台可冻结：

```text
Commission.status = frozen
```

解冻后回到原待处理状态，具体实现可通过 AuditLog 记录。

## 开团失败退款

当团购截止时间到仍未成团：

1. GroupBuy.status = failed
2. unpaid 订单关闭
3. paid 订单创建退款记录
4. 退款成功后订单 refunded
5. 开团服务奖励 cancelled
6. 写入 AuditLog

## 提现规则

第一版人工审核：

1. leader 提交提现申请。
2. 系统校验 available 金额是否足够。
3. 创建 Withdrawal.status = pending。
4. 后台审核通过。
5. 管理员线下打款。
6. 后台标记 paid。
7. 对应 Commission.status = withdrawn。

## 测试必须覆盖

- 支付成功只生成一次奖励
- 重复支付回调不重复生成奖励
- 部分退款扣减奖励
- 全额退款取消奖励
- 开团失败取消奖励
- T+7 后奖励变可提现
- 冻结奖励不能提现
- 禁止多级关系字段
