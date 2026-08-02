# L58 Mac 本地远端微信扫码演示手册

## 1. 适用范围

本手册用于少数内部体验成员短时演示：API 与临时 PostgreSQL 运行在操作者的 Mac；远端 Windows 电脑只接收二维码；远端人员用手机微信操作小程序。

本流程不是生产部署，也不是正常长期体验版。它不会使用服务器、域名、生产数据库、生产备份、微信商户号、支付证书、APIv3 密钥或真实支付/退款。

## 2. 固定安全边界

- 公网只开放临时 API 隧道。
- PostgreSQL 不发布宿主机端口。
- Admin 只绑定 `127.0.0.1`，远端无法访问。
- 用户登录使用真实 `wx.login` 与本地 AppID/AppSecret。
- 支付与退款固定为 MOCK；页面显示“演示支付，不会真实扣款”。
- 用户伪造头、自动提现、自动报税、会员生产能力均关闭。
- 默认 120 分钟自动停止，可配置范围为 30–240 分钟。
- 每次启动都会生成新随机地址、新小程序副本；必须重新上传体验版并发送新二维码。

## 3. 首次准备

### 3.1 微信侧

1. 在微信公众平台把远端人员的微信加入该小程序“体验成员”。
2. 确认操作者自己的微信账号可以使用微信开发者工具上传体验版。
3. 准备两个不同微信账号，用于双人拼团。

### 3.2 Mac 依赖

从仓库根目录检查：

```bash
node --version
pnpm --version
docker compose version
cloudflared --version
```

要求：

- Node.js 20.19+ 或 22.12+；
- pnpm 9.15.4；
- Docker Compose v2 正常运行；
- `cloudflared` 可执行；
- `/Applications` 中已安装微信开发者工具，当前项目使用 3.17.0。

若 Mac 使用 Homebrew 且尚未安装 `cloudflared`：

```bash
brew install cloudflared
```

Quick Tunnel 仅用于短时开发演示，没有 SLA。官方说明：<https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/>

### 3.3 本地演示配置

```bash
cp .env.demo.example .env.demo.local
chmod 600 .env.demo.local
```

只在 Mac 本地填写以下字段：

- `WECHAT_APP_ID`
- `WECHAT_APP_SECRET`
- `USER_SESSION_TOKEN_SECRET`
- `ADMIN_TOKEN`
- 可选 `DEMO_API_PORT`、`DEMO_ADMIN_PORT`、`DEMO_TTL_MINUTES`

`USER_SESSION_TOKEN_SECRET` 与 `ADMIN_TOKEN` 必须分别生成、至少 32 字符且不能相同。可在 Mac 本地分别运行两次 `openssl rand -hex 32`，将结果直接填入文件；不要发送到聊天、邮件或 GitHub。

配置中不得出现：

- `DATABASE_URL`
- `WECHAT_MCH_ID`
- `WECHAT_API_V3_KEY`
- 私钥或证书路径
- 真实支付/退款通知地址

启动器会拒绝额外字段、占用端口、过短/复用密钥、非 0600 文件、符号链接和超范围 TTL。

## 4. 启动演示

在第一个终端运行：

```bash
pnpm demo:remote:start
```

这个命令保持前台运行。不要关闭该终端。它依次执行：

1. 检查 Mac、Node、pnpm、Docker Compose、`cloudflared`、微信开发者工具和配置文件；
2. 启动专用 `community-selection-l58-demo` PostgreSQL 与 API；
3. 运行现有迁移和确定性演示种子；
4. 验证本地 `/api/health` 与 `/api/public/runtime`，后者必须报告 `payment_mode=mock`；
5. 启动 Quick Tunnel，并从公网再次验证健康与 MOCK 模式；
6. 生成 `.tmp/remote-demo/miniapp`；
7. 输出临时 API、小程序目录、截止时间和本机 Admin 地址。

任何一步失败，脚本都会停止已启动资源；在本地/公网 MOCK 校验通过前不会生成可上传副本。

## 5. 上传新的体验版

1. 打开微信开发者工具。
2. 导入启动器输出的 `.tmp/remote-demo/miniapp`，不要导入原始 `apps/miniapp`。
3. 确认项目 AppID 正确；`project.config.json` 已设置 `urlCheck=false`。
4. 编译后检查首页、商品页和订单确认页；订单确认页应显示“演示支付，不会真实扣款”。
5. 上传一个明确标记为 `L58 临时远端演示` 的新体验版。
6. 把本次新体验二维码发给已添加的体验成员。

远端体验成员在手机微信中开启调试模式后操作。若对方微信版本没有调试入口或请求仍被合法域名校验拒绝，立即执行停止命令并改为屏幕共享，不开放路由器端口、不使用公网 IP、不关闭后端鉴权。

## 6. 启动 Mac 本机 Admin

在第二个终端运行：

```bash
pnpm demo:remote:admin
```

打开命令输出的 `http://127.0.0.1:<端口>`。该入口只绑定 Mac 回环地址，并从 `.env.demo.local` 将强随机 `ADMIN_TOKEN` 注入本地开发请求；AppSecret 和用户会话密钥不会传给 Admin 子进程或浏览器构建。

不要通过隧道、远控端口转发或路由器映射分享 Admin。

## 7. 演示顺序

### 7.1 登录和普通购买

1. 远端体验成员扫码，确认真实微信登录成功。
2. 选择商品、社区和自提点。
3. 提交普通订单。
4. 确认页面显示“演示支付，不会真实扣款”。
5. 完成 MOCK 支付，确认微信没有真实扣款记录。
6. 在订单中心查看自己的订单。

### 7.2 双人拼团

1. 第一个微信账号发起双人团。
2. 第二个微信账号参与同一个团。
3. 两个账号分别完成 MOCK 支付。
4. 确认拼团由系统正常流转为成团，禁止人工修改数据库制造成团。
5. 确认任一账号无法读取另一账号的订单详情。

### 7.3 售后退款

1. 远端体验成员从自己的订单中心提交售后。
2. 操作者只在 Mac 本机 Admin 审核售后并执行 MOCK 退款。
3. 远端手机刷新订单，确认退款状态与金额正确。
4. 退款金额继续遵守整数分和“不可上调”规则。

## 8. 正常停止和自动停止

在任意第二终端运行：

```bash
pnpm demo:remote:stop
```

也可以在 `start` 终端按 `Ctrl-C`。到达 TTL 后会自动执行同一清理流程。

停止器只会：

- 验证并停止记录的 `cloudflared` PID；
- 停止 `community-selection-l58-demo` Compose project；
- 删除该 project 的临时卷；
- 删除 `.tmp/remote-demo` 中生成的 Compose、状态和小程序副本。

若 PID 命令与记录不匹配，停止器不会发送信号，并会要求人工检查。它不使用 `pkill`、全局 Docker prune 或模糊卷名。

停止后，用启动时输出的旧地址检查 `/api/health`，应无法继续访问。旧体验版因 API 地址失效不得再次使用。

## 9. 必须立即停止的情况

遇到以下任一情况，立即运行 `pnpm demo:remote:stop`：

- `/api/public/runtime` 报告 `wechat`；
- 手机出现真实支付界面或任何扣款迹象；
- Quick Tunnel 地址变化、频繁断连或出现多个地址；
- 微信登录持续失败；
- 出现未知用户或异常流量；
- 体验版上传失败或手机无法开启调试模式；
- 演示时间已到。

停止后回退为屏幕共享。不要放松 MOCK、管理员鉴权、用户身份、数据库网络或域名安全边界。

## 10. 人工验收记录

每次演示只记录以下脱敏信息：

- 日期和操作者别名；
- 候选 Git SHA；
- 是否完成登录、普通购买、双人拼团、订单隔离、售后退款和停止后失效；
- 问题分类与安全错误码；
- 不含 openid、手机号、地址、完整订单号、微信 code、会话令牌或任何密钥的备注。

微信网络规则参考：<https://www.tencentcloud.com/document/product/1219/61745>
