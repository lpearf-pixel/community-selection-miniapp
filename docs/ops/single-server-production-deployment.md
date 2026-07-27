# 单机生产部署手册

适用范围：首版单台 Ubuntu 22.04/24.04 云服务器，购买、拼团、微信支付/退款和后台管理共用一套 PostgreSQL；不包含真实服务器、域名和密钥本身。

## 1. 主机与网络

- 最低 2 核 4 GB，推荐 4 核 8 GB；系统盘建议 80 GB 起。
- DNS 创建两个 A/AAAA 记录：`API_DOMAIN`、`ADMIN_DOMAIN` 均指向服务器。
- 安全组只公开 SSH 管理来源、TCP 80 和 443；不得公开 5432、13080 或 Caddy 管理端口 2019。
- Caddy 自动申请证书要求域名已解析、80/443 可从公网访问、证书数据卷可持久化。参考 [Caddy Automatic HTTPS](https://caddyserver.com/docs/automatic-https)。

## 2. 安装 Docker Engine 与 Compose v2

按照 [Docker 官方 Ubuntu 安装文档](https://docs.docker.com/engine/install/ubuntu/) 配置官方 apt 仓库，然后安装：

```bash
sudo apt-get update
sudo apt-get install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo docker version
sudo docker compose version
```

不要在生产机使用 Docker convenience script。若把运营账号加入 `docker` 组，须知该组拥有等同 root 的高权限；也可以始终使用 `sudo docker`。

## 3. 目录与密钥

```bash
sudo install -d -m 0750 -o "$USER" -g "$USER" /opt/community-selection
cd /opt/community-selection
git clone <仓库地址> app
cd app
git checkout <已验收提交>
cp .env.production.example .env.production
install -d -m 0700 secrets
install -m 0600 /安全来源/apiclient_key.pem secrets/wechat_private_key.pem
install -m 0600 /安全来源/wechatpay_platform.pem secrets/wechat_platform_certificate.pem
openssl rand -base64 48 > secrets/backup_passphrase
chown 1000:1000 secrets/wechat_private_key.pem secrets/wechat_platform_certificate.pem
chmod 0600 .env.production secrets/*
```

生产配置中的 `WECHAT_PRIVATE_KEY_PATH` 与 `WECHAT_PAY_PLATFORM_CERT_PATH` 保持 `/run/secrets/...` 容器路径；Compose 负责把宿主机 `secrets/` 只读挂载进去。API 镜像以 UID 1000 运行，因此两份微信 PEM 必须由 UID 1000 持有并保持 `0600`；预检会解析私钥和证书、验证所有权、证书有效期，并核对证书序列号与 `WECHAT_PAY_PLATFORM_SERIAL_NO`。`.env.production` 也必须为 `0600`。不要把密钥放入 `.env.production`，不要提交 `secrets/`。

生成独立随机值：

```bash
openssl rand -hex 32
openssl rand -base64 48 | tr -d '=+/' | cut -c1-48
```

`ADMIN_TOKEN`、`ADMIN_TOTP_ENCRYPTION_KEY`、`USER_SESSION_TOKEN_SECRET`、`WECHAT_API_V3_KEY` 和数据库密码不得复用。数据库密码使用 URL-safe 字符，并同步写入 `DATABASE_URL`。

## 4. 微信侧配置

- 小程序 request 合法域名：`https://API_DOMAIN`。
- 支付通知：`https://API_DOMAIN/api/payments/wechat/notify`。
- 退款通知：`https://API_DOMAIN/api/refunds/wechat/notify`。
- 核对商户号、商户证书序列号、平台证书序列号、API v3 key 和 AppID 属于同一生产商户配置。
- 保持自动打款、商家转账和自动报税开关为 `false`。

## 5. 上线

先运行不会改数据库的预检：

```bash
pnpm install --frozen-lockfile
ENV_FILE=.env.production pnpm prod:preflight
```

然后部署：

```bash
ENV_FILE=.env.production pnpm prod:deploy
```

部署脚本按以下顺序执行：

1. 校验环境、密钥权限、Compose v2 和渲染结果。
2. 构建带 `IMAGE_TAG` 的 API、Edge、Ops 镜像。
3. 已存在数据库卷时，先生成加密备份。
4. 启动 PostgreSQL，执行一次性 `prisma migrate deploy`。
5. 只启动一个 API 实例和 Caddy。
6. 验证 API HTTPS 包络、Admin HTML、两个 HTTP→HTTPS 重定向。

查看状态与日志：

```bash
docker compose --project-name community-selection-production \
  --env-file .env.production -f docker-compose.production.yml ps
docker compose --project-name community-selection-production \
  --env-file .env.production -f docker-compose.production.yml logs --tail=200 api edge postgres
```

## 6. 备份、恢复与回滚

手工备份：

```bash
ENV_FILE=.env.production pnpm prod:backup
```

每日由系统定时器执行同一命令；至少保留 14 天。恢复必须先停止写流量并在演练库确认备份：

```bash
export BACKUP_FILE=/var/backups/community-selection/community_selection_YYYYMMDDTHHMMSSZ.dump.gpg
export RESTORE_CONFIRM=RESTORE_COMMUNITY_SELECTION
ENV_FILE=.env.production pnpm prod:restore
```

应用回滚不逆转数据库迁移：

```bash
export PREVIOUS_IMAGE_TAG=<上一个已验收 Git SHA>
export ROLLBACK_CONFIRM=ROLLBACK_COMMUNITY_SELECTION
ENV_FILE=.env.production pnpm prod:rollback
```

若旧应用与新数据库 schema 不兼容，停止回滚并按事故流程处理；只有明确决定恢复到备份时间点时才执行数据库恢复。

## 7. 上线完成条件

- L52 Production Readiness 与受影响的历史门禁全部成功。
- `pnpm prod:smoke` 成功。
- 完成 [购买与拼团生产验收](purchase-group-production-acceptance.md)。
- 生成一份加密备份，并在独立演练库完成恢复。
- 记录当前 `IMAGE_TAG`、上一个可回滚 `IMAGE_TAG`、备份文件、验收人和时间。
