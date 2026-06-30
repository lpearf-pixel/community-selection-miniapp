# 异常处理预案

## 支付异常

- 先确认 WECHAT_PAY_MODE 当前模式。
- 查询 Payment、Order、BusinessEventLog。
- 未确认回调安全前，不手工批量修改订单。

## 退款异常

- 查询 Refund、Order、ConsumerCreditLedger。
- 检查是否重复退款、是否重复退回消费额度。
- 必要时创建 OpsAlertLog 并人工复核。

## 提现异常

- 查询 Withdrawal、Commission、TaxRecord。
- 提现状态异常时暂停标记已处理。
- 已处理后发生退款时必须人工复核。

## 数据异常

- 立即停止相关操作入口。
- 导出业务日志和时间线。
- 根据最近备份与审计记录制定恢复方案。
