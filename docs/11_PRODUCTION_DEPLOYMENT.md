# L11 生产部署与灰度运营准备

## 目标与边界

本阶段只做生产部署、灰度运营和事故处理准备，不新增业务能力。生产默认保持支付 MOCK，切换真实微信支付必须走人工 checklist；提现仍为后台人工处理，税务仍为人工复核记录。

## 部署拓扑建议

- Nginx：负责 HTTPS、域名、静态资源与反向代理。
- API：Node.js + Fastify，监听内网端口 `13080`。
- Admin：Vite build 后由 Nginx 托管静态资源，或灰度阶段使用独立 Node 进程托管。
- PostgreSQL：独立数据盘，开启定期备份。
- 证书与私钥：只存放在服务器受控目录，不提交 Git。

## 域名与 HTTPS

- API 域名示例：`api.example.com`
- 管理后台域名示例：`admin.example.com`
- 小程序 request 合法域名需配置 API 域名。
- HTTPS 证书到期前至少 7 天更新。
- 参考模板：`deploy/nginx/community-selection.conf`

## 部署步骤

1. 准备 `.env.production`，参考 `docs/production-checklist.md`。
2. 执行：`pnpm install --frozen-lockfile`。
3. 执行：`pnpm env:check && pnpm migrations:check && pnpm compliance:scan`。
4. 执行：`pnpm db:generate && pnpm db:migrate`。
5. 执行：`pnpm build`。
6. 启动 API，并确认 `/health` 返回成功。
7. 配置 Nginx，启用 HTTPS。
8. 小程序后台配置合法域名后提交体验版验证。
9. 执行灰度运营 SOP。

## 回滚原则

- 应用回滚：保留上一版本镜像或构建产物。
- 数据回滚：优先恢复上线前备份，再回退应用版本。
- 涉及金额、订单、退款、开团服务奖励、提现状态的数据修复必须保留人工记录。
