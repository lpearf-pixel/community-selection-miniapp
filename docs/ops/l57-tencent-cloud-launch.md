# L57 腾讯云上海生产上线手册

本手册只执行真实生产部署和灰度验收，不新增业务功能。目标为腾讯云上海 `ap-shanghai`：Ubuntu 22.04/24.04、4 核 8 GB、100 GB SSD、10 Mbps，单 API/调度实例与 PostgreSQL 16。

## 1. 上线输入

以下值必须由运营方在生产机安全保存，不得发到 GitHub、验收 JSON、截图或聊天记录：

- 服务器公网 IPv4、受限 SSH 来源 CIDR。
- 已备案的 API/Admin 域名及运营邮箱。
- 小程序 AppID/App Secret、商户号、API v3 key、商户私钥、平台证书和序列号。
- PostgreSQL、Admin session/TOTP、用户 session、会员手机号 HMAC 和备份加密独立密钥。
- COS bucket/路径及最小权限上传身份。
- 两个真实微信测试账号、一个社区、一个自提点和 0.01–0.10 元测试商品。

`.env.production` 是非文件型运行配置的唯一入口；PEM 与备份口令只放 `secrets/`。新增地址或开关不得直接写入 Compose、脚本或 GitHub workflow。

## 2. 腾讯云与备案前置

- 地域为上海，CVM 购买配置达到 4C8G/100GB/10Mbps；只把控制台显示的实例 ID、实例规格写入 `TENCENT_CLOUD_INSTANCE_ID`、`TENCENT_CLOUD_INSTANCE_TYPE`，公网带宽不接受手填值。
- 给生产 CVM 绑定只允许 `cvm:DescribeInstances` 的 CAM 角色，并安装 TCCLI。就绪脚本使用官方 [`--use-cvm-role`](https://cloud.tencent.com/document/product/440/129328) 获取临时凭证，不在命令行或 env 保存 SecretId/SecretKey。
- 安全组只开放来源受限的 SSH、TCP 80/443；5432、13080、2019 不开放。
- `API_DOMAIN`、`ADMIN_DOMAIN` 的 A 记录都指向 `PRODUCTION_PUBLIC_IPV4`。
- 域名实名认证、ICP备案、小程序备案、经营类目/资质和隐私协议已通过。
- 微信公众平台 request 合法域名为 API HTTPS 域名；支付与退款通知 URL 与 `.env.production` 完全一致。
- COS 只接收 `.dump.gpg` 加密文件，开启生命周期和版本保留；不上传 `.env.production`、PEM、口令或明文 dump。

## 3. 发布候选

发布 SHA 必须是 Draft PR 最终公共门禁验证的 40 位 head，禁止使用 `latest`、分支名或未验收工作树：

```bash
git fetch origin stable/l50-a3-4-business-base
git checkout <40位候选SHA>
cp .env.production.example .env.production
chmod 0600 .env.production secrets/*
ENV_FILE=.env.production pnpm prod:l57:readiness
ENV_FILE=.env.production pnpm prod:preflight
```

`IMAGE_TAG` 必须等于当前 Git HEAD。门禁从[腾讯云实例元数据](https://cloud.tencent.com/document/product/213/4934)独立读取地域、实例 ID、实例规格和公网 IPv4，再通过只读 [`DescribeInstances`](https://cloud.tencent.com/document/product/213/15728) 实时核对实例为 RUNNING、上海可用区、4 核、8 GiB、100 GB 系统盘、公网 IP 和 `InternetMaxBandwidthOut >= 10`；两个生产域名的 A 记录集合必须精确等于该公网 IPv4，不能保留旧地址。操作系统必须为 Ubuntu 22.04/24.04，系统可用内存最低 7680 MiB。

## 4. 部署与回退证据

部署前记录上一已验收 `IMAGE_TAG`，再执行：

```bash
ENV_FILE=.env.production pnpm prod:deploy
ENV_FILE=.env.production pnpm prod:backup
export BACKUP_FILE=/var/backups/community-selection/community_selection_YYYYMMDDTHHMMSSZ.dump.gpg
export RESTORE_DRILL_CONFIRM=RESTORE_IN_ISOLATED_DRILL
ENV_FILE=.env.production pnpm prod:restore:drill
```

恢复成功输出必须含 `release_sha`、加密备份文件名，以及带标签的 `migrations`、`orders`、`payments`、`refunds`、`group_buys` 计数；不得用无标签数字或 `unknown` 作为验收证据。

将同一 `.dump.gpg` 上传 COS，并从 COS 下载到隔离目录做一次可解密检查。应用回滚只使用上一已验收镜像，不执行逆向迁移：

```bash
export PREVIOUS_IMAGE_TAG=<上一已验收40位SHA>
export ROLLBACK_CONFIRM=ROLLBACK_COMMUNITY_SELECTION
ENV_FILE=.env.production pnpm prod:rollback
```

## 5. 最小监控与告警

上线前在腾讯云云监控配置接收人和以下告警：

- CPU 连续 10 分钟超过 85%。
- 内存连续 10 分钟超过 85%。
- 系统盘使用率超过 80% 告警、超过 90% 严重告警。
- API HTTPS `/api/health` 每分钟探测失败。
- `api`、`edge` 或 `postgres` 容器退出/反复重启。
- PostgreSQL 不可用或连接数接近上限。
- 26 小时没有新的本地及 COS 加密备份。
- `OpsAlertLog` 存在未处理 Critical 告警。

本阶段不做自动修复。告警后按 `incident-response.md` 停止相关入口、保存证据、人工判断回滚或恢复。

## 6. 灰度顺序

1. 用两个内部真实微信账号完成 `core_gray`，会员能力保持关闭。
2. 验收 JSON 通过固定 SHA 校验后，只向一个微信群、一个社区和少量商品开放。
3. 连续 3 天每日核对订单、支付、退款、库存、拼团状态和告警。
4. 核心链路稳定后才执行独立 `membership_gray`；M01–M04 全部通过前不对普通用户开放会员能力。
5. 任一资金状态不确定、退款缺失、库存重复扣减、备份/恢复失败或 Critical 告警未闭环，立即停止放量。

## 7. L57 完成判定

- 同一候选 SHA 的 L50/L51/L52/L53/L56/L57 受影响门禁全部成功。
- 公网 smoke、加密备份、COS 副本和隔离恢复演练均成功。
- `core_gray` 验收文件通过校验并连续 3 天对账无差异。
- 上一镜像完成一次回滚再切回演练。
- 会员能力仍关闭，或已另行通过完整 `membership_gray` 后受控开启。
