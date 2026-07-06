# L23 MVP 环境配置说明

## 1. 后端环境变量

- NODE_ENV：建议本地为 `development`。
- API_HOST：本地建议 `127.0.0.1`。
- API_PORT：本地建议 `13080`。
- API_BASE_URL：本地建议 `http://127.0.0.1:13080`。
- WECHAT_PAY_MODE=mock。
- MOCK_WECHAT_PAY=true。
- AUTO_PAYOUT_ENABLED=false。
- AUTO_TAX_FILING_ENABLED=false。
- DATABASE_URL：如项目使用 PostgreSQL，本地示例为 `postgresql://postgres:postgres@localhost:15432/community_selection?schema=public`。
- NO_PROXY / no_proxy：本地验证建议包含 `localhost,127.0.0.1,::1`。

## 2. 小程序环境配置

- API_BASE_URL storage key：`API_BASE_URL`。
- 默认值：`http://127.0.0.1:13080`。
- mock user storage key：当前实现使用 `community_selection_user`。
- 当前选择社区 storage key：`selected_community`。
- 当前选择自提点 storage key：`selected_pickup_store`。

## 3. 本地启动建议

按当前 package.json 脚本：

```bash
pnpm install
pnpm build
pnpm --filter @community-selection/api dev
```

## 4. 验证命令

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
bash scripts/local-verify.sh
pnpm exec tsx scripts/verify-l23-mvp-release-readiness-local.ts
pnpm report:stage -- --stage=L23
```

## 5. 注意事项

- 不要开启真实微信支付。
- 不要设置 AUTO_PAYOUT_ENABLED=true。
- 不要设置 AUTO_TAX_FILING_ENABLED=true。
- 本地 localhost 代理要注意 NO_PROXY。
