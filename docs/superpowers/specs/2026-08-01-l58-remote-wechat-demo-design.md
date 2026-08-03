# L58 远端微信扫码演示设计

## 1. 目标

在不购买或使用服务器、不接入真实微信支付、不触碰生产配置和生产数据的前提下，让已加入小程序“体验成员”的远端人员在自己的手机微信中扫码，访问运行在用户 Mac 上的演示环境，完成普通购买、双人拼团、订单查看和售后退款体验。

远端 Windows 电脑只用于接收二维码或沟通；实际操作端是远端人员的手机微信。Mac 负责运行独立 PostgreSQL、API、微信开发者工具和临时 HTTPS 隧道。

## 2. 已确认前提

- 对方微信可以加入小程序体验成员。
- 当前没有已备案域名，不为本次演示购买服务器或域名。
- 演示使用真实 `wx.login`，因此 Mac 本地需要该小程序的 AppID 和 AppSecret。
- 支付与退款提供方固定为 MOCK，不配置商户号、支付证书、APIv3 密钥或真实支付通知地址。
- 演示数据与日常开发库、生产库完全隔离。
- 服务器、DNS、生产发布、会员生产启用和真实微信小额支付继续冻结。

微信网络规则要求小程序预先配置通信域名，域名不能使用 IP 或 `localhost`；微信开发者工具勾选“不校验合法域名”后，手机调试模式也可以跳过校验。因此本方案仅用于少数内部体验成员的临时调试演示，不视为正常体验版或生产上线能力。

## 3. 方案选择

### 3.1 采用：Cloudflare Quick Tunnel + 手机调试模式

Mac 上的 `cloudflared` 通过出站连接生成随机 `*.trycloudflare.com` HTTPS 地址，将流量代理到仅监听本机回环地址的演示 API。该地址写入一次性生成的小程序演示副本，随后由微信开发者工具上传为体验版。

选择原因：

- 不要求已有域名、Cloudflare 账号或公网 IP；
- 不开放路由器入站端口；
- 隧道进程停止后随机地址立即失效；
- 适合短时开发与演示，不被误用作生产入口。

Quick Tunnel 没有 SLA，地址每次启动都会变化，并存在并发限制；这些限制可接受，因为本阶段只允许少量内部体验成员短时使用。

### 3.2 延后：备案域名 + 固定 HTTPS 子域名

这是后续正常体验版和生产灰度的正确方案，可关闭手机调试模式并长期复用地址，但当前需要域名、备案和正式网络配置，超出本阶段范围。

### 3.3 回退：屏幕共享

若对方手机或微信版本无法开启调试模式、Quick Tunnel 不可用、体验版上传失败或外网请求不稳定，立即停止隧道并改为屏幕共享。不放松域名校验，不改用公网 IP，也不把数据库或后台直接暴露到互联网。

## 4. 架构与隔离边界

演示环境保持现有单体架构，但使用独立 Compose project 和独立数据卷：

| 组件 | 运行位置 | 网络边界 | 数据/凭据 |
|---|---|---|---|
| PostgreSQL 16 | Mac Docker | 不发布宿主机端口 | 独立临时卷，只含演示数据 |
| Fastify API | Mac Docker | 只绑定 `127.0.0.1` 的演示端口 | MOCK 支付、真实微信登录 |
| Admin | Mac 本地或 Docker | 只允许 Mac 本机访问，不进入隧道 | 强随机管理员令牌 |
| `cloudflared` | Mac | 仅出站连接；只代理 API | 不持有数据库或微信密钥 |
| 小程序演示副本 | Mac 临时目录、微信体验版 | API 地址为本次随机 HTTPS URL | 不包含 AppSecret、管理员令牌或支付密钥 |
| 远端手机 | 对方微信 | 通过临时 HTTPS URL 访问 API | 仅持有自己的用户会话 |

演示不得复用生产 Compose project 名、生产卷名、`.env.production`、`secrets/` 或任何生产备份。默认演示 API 端口与日常开发端口分离，避免误连正在运行的本地开发库。

## 5. 组件设计

### 5.1 本地机密配置

新增被 Git 忽略的 `.env.demo.local`，只允许包含：

- `WECHAT_APP_ID`
- `WECHAT_APP_SECRET`
- 自动生成且不少于 32 字符的 `USER_SESSION_TOKEN_SECRET`
- 自动生成的 `ADMIN_TOKEN`
- 可选的演示端口和最长运行时间

文件权限必须为仅当前用户可读写。启动脚本不得打印、复制或上传这些值。演示配置明确拒绝微信商户号、私钥、平台证书、APIv3 密钥、真实支付/退款通知地址和任何生产数据库地址。

### 5.2 演示 Compose

演示 Compose 只启动 PostgreSQL 与 API；Admin 需要处理退款时由 Mac 本机单独启动。关键环境值固定为：

- `NODE_ENV=development`
- `WECHAT_PAY_MODE=mock`
- `MOCK_WECHAT_PAY=true`
- `CURRENT_USER_MOCK_HEADERS_ENABLED=false`
- `ADMIN_AUTH_ENABLED=true`
- `ADMIN_AUTH_MODE=token`
- `AUTO_PAYOUT_ENABLED=false`
- `AUTO_TAX_FILING_ENABLED=false`
- `FIRST_LAUNCH_MODE=true`

API 必须连接 Compose 内部 PostgreSQL 主机名，数据库不发布宿主机端口。API 宿主机端口只绑定 `127.0.0.1`。启动时执行现有迁移并装载确定性的 L58 演示数据；不得从开发库或生产备份复制数据。

### 5.3 演示编排器

提供两个入口：

- `pnpm demo:remote:start`
- `pnpm demo:remote:stop`

启动流程：

1. 校验 Node、pnpm、Docker Compose、`cloudflared`、微信开发者工具和 `.env.demo.local`。
2. 拒绝生产数据库地址、真实支付模式、已被占用的演示端口和过宽的机密文件权限。
3. 使用固定且专用的 Compose project 启动数据库和 API，等待本地健康检查通过。
4. 启动 Quick Tunnel，只接受由 `cloudflared` 输出的单个 `https://*.trycloudflare.com` 地址。
5. 通过该 HTTPS 地址再次执行健康检查，确认公网入口真实可达。
6. 将 `apps/miniapp` 复制到被 Git 忽略的临时目录，只在副本的集中配置中注入本次 HTTPS API 地址。
7. 输出可公开的演示目录、隧道地址、截止时间和微信开发者工具操作步骤，不输出任何机密。
8. 到达默认 120 分钟截止时间或收到停止信号时自动清理。

最长运行时间允许在 30–240 分钟内调整；超出范围直接拒绝。启动与停止均需幂等，不允许使用不带目标校验的 `pkill`、全局 Docker 清理或模糊卷名删除。

### 5.4 小程序演示副本

不修改或提交 `apps/miniapp/config.js` 中的随机 URL。编排器生成一次性副本，并在副本中设置 `apiBaseUrl`。微信 AppID 只写入被忽略的开发者工具项目配置；AppSecret 永远不进入小程序源码或上传包。

由于 Quick Tunnel 地址每次变化，每次重新启动演示环境后都必须重新上传体验版并发送新的体验二维码。旧体验版不得被当作仍可用版本。

### 5.5 本机 Admin

退款审核或订单状态推进由操作者在 Mac 本机完成。Admin 不通过 Quick Tunnel 暴露；其 API 请求使用强随机管理员令牌。远端体验成员只能执行小程序用户侧操作，不能访问管理员路由、数据库或 Docker。

## 6. 数据流与演示场景

### 6.1 登录

1. 体验成员扫码打开体验版并开启调试模式。
2. 小程序调用 `wx.login` 获取一次性 code。
3. code 经 Quick Tunnel 到达 Mac API。
4. API 使用本地 AppID/AppSecret 调用微信 `code2session`，创建演示库用户和会话。
5. 小程序只保存自己的 Bearer 会话；服务端日志不输出 code、openid、AppSecret 或会话令牌。

### 6.2 购买与 MOCK 支付

小程序从演示库读取首发允许品类的种子商品。用户下单后，API 的 `/api/public/runtime` 必须明确返回 `payment_mode=mock`，小程序才可调用 MOCK 支付。页面需清晰显示“演示支付，不会真实扣款”。

### 6.3 双人拼团

远端体验成员与操作者手机使用两个不同微信账号完成开团和参团。拼团人数、库存、订单和成团状态全部来自演示库，不允许人工改数据库制造成功状态。

### 6.4 订单与退款

远端体验成员从订单中心进入售后申请。操作者只在 Mac 本机 Admin 审核并执行 MOCK 退款；远端手机刷新后看到退款状态和金额变化。退款金额仍使用整数分及现有不可上调规则。

## 7. 故障处理与停止语义

- Docker、API、迁移或种子数据失败：不启动隧道。
- 隧道未产生唯一合法 HTTPS URL：停止已启动资源并报错。
- 公网健康检查失败：不生成小程序演示副本，不上传体验版。
- 微信登录失败：只显示安全错误码，优先检查 AppID/AppSecret 与体验成员身份，不切换到伪造用户头。
- 手机调试模式关闭导致域名校验失败：重新开启调试；若入口不可用则回退屏幕共享。
- MOCK 支付保护未生效或运行时报告 `wechat`：立即停止演示，禁止继续下单。
- 发生异常流量、未知用户或演示超时：执行停止命令，关闭隧道并删除演示卷。
- 停止只针对记录过的 Compose project、容器、卷和 `cloudflared` PID；PID 对应进程不匹配时不发送信号并报告人工检查。

停止完成后，旧 HTTPS URL 必须不可访问；演示数据库卷和生成的小程序副本默认删除。只保留脱敏日志摘要，不保留 openid、手机号、地址、会话、订单完整标识或微信登录 code。

## 8. 测试与验收

### 8.1 自动测试

- 编排器单元测试：环境校验、TTL 边界、Quick Tunnel URL 解析、PID/Compose 目标校验和脱敏输出。
- Compose 契约测试：独立 project/volume、数据库无宿主机端口、API 仅绑定回环地址、Admin 不在隧道启动集合。
- 安全契约测试：强制 MOCK、禁用用户伪造头、管理员鉴权开启、自动提现/报税关闭、拒绝生产地址和真实支付密钥。
- 生成副本测试：只修改临时副本，随机 URL 不进入 Git，AppSecret 与管理员令牌不进入上传目录。
- 生命周期测试：启动失败会回滚资源；停止重复执行安全；不会清理其他 Compose project 或 Docker 卷。
- 现有门禁：`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`。

CI 不真实连接 Cloudflare 或微信，不上传体验版；外部进程和网络响应使用注入替身验证。

### 8.2 人工验收

在远端手机与 Mac 不同网络的条件下完成：

1. 体验成员扫码并成功登录。
2. 普通购买与 MOCK 支付成功，确认无真实扣款。
3. 两个微信账号完成开团、参团和成团。
4. 远端用户在订单中心看到自己的订单，不可读取另一账号订单。
5. 远端用户提交售后；Mac 本机 Admin 完成 MOCK 退款；远端看到正确退款结果。
6. 远端无法访问管理员能力，数据库端口不可从局域网或公网访问。
7. 执行停止后，旧隧道地址失效，演示数据被删除，日常开发环境不受影响。

## 9. 完成标准

- 所有自动测试和仓库门禁通过。
- 演示启动和停止均为一条命令，失败时保持 fail-closed。
- 远端体验成员在手机调试模式下完成登录、普通购买、双人拼团、订单查看和退款闭环。
- 整个过程没有真实支付、真实退款、自动提现、生产连接、数据库公网端口或机密泄露。
- 演示结束后随机 HTTPS 地址和演示数据均不可继续使用。

## 10. 后续迁移

获得已备案域名后，远端演示应迁移到固定 HTTPS 子域名并配置为微信 `request` 合法域名，关闭手机调试模式。Quick Tunnel 相关入口继续标记为内部临时工具，不演变为生产部署路径。

## 11. 官方依据

- 微信/腾讯网络规则：<https://www.tencentcloud.com/document/product/1219/61745>
- Cloudflare Quick Tunnel：<https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/>
