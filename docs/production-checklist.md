# 生产前 Checklist

## 环境变量清单

- `DATABASE_URL`：生产 PostgreSQL 连接串，必须使用生产库账号与独立权限。
- `PORT`：API 服务端口。
- `ADMIN_TOKEN`：后台管理员令牌，必须强随机，不得使用 `dev-admin-token`。
- `ADMIN_AUTH_ENABLED`：生产必须为 `true`。
- `WECHAT_PAY_MODE`：默认 `mock`；切换为 `wechat` 前必须完成人工配置复核。
- `MOCK_WECHAT_PAY`：默认 `true`；真实支付模式需明确设置为 `false`。
- `WECHAT_APP_ID` / `WECHAT_MCH_ID` / `WECHAT_MCH_SERIAL_NO` / `WECHAT_API_V3_KEY` / `WECHAT_PRIVATE_KEY_PATH` / `WECHAT_PAY_NOTIFY_URL`：启用 `WECHAT_PAY_MODE=wechat` 前必须完整配置。
- `WECHAT_REFUND_NOTIFY_URL`：微信退款回调预留地址，真实退款未启用前仅保留配置位。
- `AUTO_PAYOUT_ENABLED`：必须为 `false`。
- `WECHAT_TRANSFER_ENABLED`：必须为 `false`。
- `WECHAT_MERCHANT_TRANSFER_ENABLED`：必须为 `false`。
- `AUTO_TAX_FILING_ENABLED`：必须为 `false`。

## 安全与敏感信息

- 不保存完整身份证号、银行卡号、私钥、证书、token。
- 私钥和证书文件必须放在受控路径，不能提交到 Git。
- 后台访问必须启用 `ADMIN_AUTH_ENABLED=true` 并通过 `x-admin-token` 传入强随机 `ADMIN_TOKEN`。

## 上线前必须通过

```bash
pnpm env:check
pnpm migrations:check
pnpm seed:check
pnpm compliance:scan
pnpm verify:all
```

- `pnpm verify:all` 必须通过。
- compliance scan 必须通过。
- migration check 必须通过。
- seed check 必须通过。

## 数据库备份与回滚方案

- 上线前完成数据库全量备份，并记录备份文件位置、负责人和恢复演练命令。
- 每次 migration 前确认 `prisma/migrations` 已随代码合并。
- 回滚时优先恢复数据库备份，再回退应用镜像或代码版本。
- 任何涉及金额、退款、开团服务奖励、提现状态的数据修复必须保留审计记录。

## 日志和告警检查

- 检查 BusinessEventLog、OrderTimelineLog、OpsAlertLog 是否可写入和查询。
- 检查告警中心 open / resolved / ignored 状态流转。
- 检查 AI context 是否能返回订单、时间线、业务事件、告警和 suggested_focus。

## 上线后人工处理边界

- 提现只做后台人工处理，不接真实打款。
- 税务只做人工复核记录，不自动报税。
- 退款异常、提现后退款、提现审核期间退款均进入人工复核。
- 用户可见文案继续统一使用“开团服务奖励”。

## L11 后台登录上线检查

- 生产建议设置 `ADMIN_AUTH_MODE=session`，简单令牌模式仅作为短期兼容入口。
- 至少创建一个状态为 active 的 `AdminUser`，密码必须为 bcrypt hash。
- 管理员必须启用 TOTP，并离线保存一次性 recovery codes。
- `ADMIN_TOTP_ENCRYPTION_KEY` 必须为强随机值，不能与开发环境共用。
- 后台敏感操作上线前需抽查 `AdminAuditLog` 是否记录操作人、来源 IP、对象和动作。
