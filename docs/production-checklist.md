# 生产前 Checklist

## 自动门禁

```bash
pnpm prod:preflight
pnpm migrations:check
pnpm compliance:scan
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm verify:all
pnpm verify:l51
```

- L52 Runner 必须完成生产 Compose 渲染、API/Edge/Ops 镜像构建、Caddy 配置验证和一次性生产迁移。
- `stable/l50-a3-4-business-base` 的 L50、L51 与基线门禁不得因本次改动回归。
- 临时源码恢复 workflow、真实 `.env.production`、证书、私钥和备份不得进入 Git。

## 配置与安全

- `NODE_ENV=production`。
- `ADMIN_AUTH_ENABLED=true`、`ADMIN_AUTH_MODE=session`。
- `ADMIN_TOKEN` 与 `ADMIN_TOTP_ENCRYPTION_KEY` 均为独立强随机值。
- `WECHAT_PAY_MODE=wechat`、`MOCK_WECHAT_PAY=false`。
- `CURRENT_USER_MOCK_HEADERS_ENABLED=false`。
- `WECHAT_APP_ID`、App Secret、商户号、商户/平台证书序列号与 API v3 key 已交叉复核。
- `WECHAT_PRIVATE_KEY_PATH=/run/secrets/wechat_private_key.pem`。
- `WECHAT_PAY_PLATFORM_CERT_PATH=/run/secrets/wechat_platform_certificate.pem`。
- 支付与退款通知 URL 使用 API 域名 HTTPS。
- `USER_SESSION_TOKEN_SECRET` 至少 32 字符，且不与其他密钥复用。
- 自动打款、商家转账和自动报税全部保持 `false`。
- PostgreSQL 没有宿主机端口；公网只开放 80/443 和受限 SSH。

## 数据与回滚

- 上线前加密备份已生成且可解密。
- 最近 30 天内完成过独立恢复演练；首次上线必须完成一次。
- 记录当前和上一个已验收 `IMAGE_TAG`。
- 明确应用回滚不会逆转数据库迁移；schema 不兼容时不得强行回滚。
- 金额、退款、开团服务奖励和提现修复必须保留审计记录。

## 后台与人工边界

- 至少存在一个 active `AdminUser`，密码为 bcrypt hash。
- 首次登录后启用 TOTP，并离线保存一次性 recovery codes。
- 抽查 `AdminAuditLog` 包含操作人、来源 IP、对象和动作。
- 提现保持后台人工审核，不接真实自动打款。
- 税务保持人工复核记录，不自动申报。
- 退款异常、提现后退款和审核期间退款进入人工复核。

## 上线验收

- 执行 [购买与拼团生产验收](ops/purchase-group-production-acceptance.md)。
- `BusinessEventLog`、`OrderTimelineLog`、`OpsAlertLog` 可查询。
- 微信主动对账和拼团到期扫描只有一个 API 实例；数据库 advisory lock 能阻止重复执行。
- 购买、成团、失败退款和自提证据均已脱敏归档。
