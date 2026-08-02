# L58 远端微信扫码演示评审记录

## 范围

L58 只提供 Mac 本地短时演示能力：独立 PostgreSQL、API、Quick Tunnel、小程序一次性副本和本机 Admin。服务器、DNS、生产数据库、真实微信支付/退款与付费权益生产启用均保持冻结。

## 已实现的自动化边界

- `.env.demo.local` 严格白名单、0600 权限、独立强密钥、隔离端口和 30–240 分钟 TTL。
- Compose 模型只有 PostgreSQL 与 API；数据库无宿主机端口，API 只绑定 `127.0.0.1`。
- 支付固定 MOCK，用户伪造头、自动提现、自动报税和首发禁用能力均 fail-closed。
- Quick Tunnel 只接受唯一 `https://*.trycloudflare.com` origin。
- 小程序随机 URL 与 `remoteDemo=true` 只进入 `.tmp/remote-demo/miniapp`；源树不写入随机 URL。
- AppSecret、Admin token 与用户会话密钥会扫描并拒绝进入小程序副本。
- 启动失败、信号、显式停止和 TTL 均走有界清理；PID 不匹配时不误杀进程。
- 本机 Admin 绑定回环地址，并仅在 Vite 开发模式为旧/新请求入口添加 `x-admin-token`。
- 演示副本显示“演示支付，不会真实扣款”，支付执行仍由后端运行时 `payment_mode` 控制。

## 自动验证状态

本地候选验证：

- `pnpm test:remote-demo`：42/42 通过；
- Admin token 新旧请求入口集成测试：2/2 通过；
- `pnpm lint`：通过；
- `pnpm typecheck`：通过；
- `pnpm build`：通过；
- `pnpm test`：当前 Codex 容器没有 `DATABASE_URL` 或 PostgreSQL，既有数据库集成套件在 Prisma 初始化时失败；非数据库 API 测试 815 项通过，不能据此标记全仓测试通过；
- `docker compose ... config --format json`：当前 Codex 容器没有 Docker CLI，待 GitHub 托管的 `ubuntu-latest` Runner 执行 `pnpm demo:remote:verify-topology`；
- GitHub 托管 Runner 最终候选：待 Draft PR 发布后由独立 `L58 Remote Demo Gate` 执行隔离 PostgreSQL、完整 `pnpm test` 和 Compose v2 解析。

本地环境缺少数据库与 Docker 是验证条件缺失，不通过跳过集成测试或削弱拓扑断言处理。只有 GitHub 托管的 L58 门禁全绿后，才能标记自动门禁完成。

## 真实 Mac/手机验收

状态：尚未执行。

真实验收需要用户 Mac、微信开发者工具 3.17.0、有效 AppID/AppSecret、已添加的体验成员、两个微信账号和不同网络的远端手机。完成前不得宣称远端扫码、真实 `wx.login`、双人拼团或退款演示已经通过。

验收步骤以 `docs/runbooks/l58-remote-wechat-demo.md` 为准，至少覆盖：

1. 远端体验成员扫码并登录；
2. 普通购买与 MOCK 支付，无真实扣款；
3. 两个微信账号正常成团；
4. 订单身份隔离；
5. Mac 本机 Admin 审核并完成 MOCK 退款；
6. 远端不能访问 Admin，数据库没有公网/局域网端口；
7. 停止后旧 Quick Tunnel 地址失效，演示卷和副本删除，日常开发环境不受影响。

## 停止条件

运行时若报告真实支付模式、发生未知流量、合法域名调试不可用、隧道不稳定或任何真实扣款迹象，必须停止并回退屏幕共享，不得放松安全开关。
