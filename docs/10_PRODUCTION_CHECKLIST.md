# L10 上线前工程化 Checklist

## 配置与启动

- 复制 `.env.example` 并按环境填写，不提交真实密钥、证书或本机绝对路径。
- 默认 `WECHAT_PAY_MODE=mock`、`MOCK_WECHAT_PAY=true`；真实微信支付只允许在配置齐全且人工确认后切换。
- `AUTO_PAYOUT_ENABLED=false`，第一版不启用真实打款。
- `AUTO_TAX_FILING_ENABLED=false`，第一版只保留税务复核记录，不做自动报税。
- 本地一键启动可使用 `docker compose up postgres api admin`。

## 上线前命令

```bash
pnpm env:check
pnpm migrations:check
pnpm compliance:scan
pnpm verify:all
```

## 数据与迁移

- 确认 `prisma/migrations` 中 migration 均已提交且非空。
- seed 数据仅用于本地/演示环境，生产环境导入前应人工确认商品、社区、开团人和库存。
- 金额字段继续使用整数分。

## 后台与 API 安全边界

- 后台登录保护由 `ADMIN_AUTH_ENABLED` / `ADMIN_TOKEN` 预留；生产环境必须显式设置。
- API 权限中间件仅做预留，不改变当前本地验收流程。
- 不保存完整身份证号、银行卡号；日志继续使用脱敏写入。

## 合规边界

- 用户可见文案统一使用“开团服务奖励”。
- 不新增多级关系字段。
- 不启用真实退款、真实打款或自动报税。
