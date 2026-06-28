# 10 部署说明

## 第一阶段部署目标

第一阶段追求低开销和稳定可跑。

推荐配置：

- 服务器：2C4G
- 系统：Ubuntu 22.04 或 24.04
- 数据库：PostgreSQL 16
- 运行方式：Docker Compose
- 反向代理：Nginx
- HTTPS：Let's Encrypt

## 服务组成

```text
api       Fastify API
admin     React 静态后台
postgres  PostgreSQL
nginx     反向代理，后续添加
```

第一版不部署：

- Redis
- MQ
- Elasticsearch
- Kubernetes

## 环境变量

生产环境必须配置：

```env
NODE_ENV=production
PORT=3000
DATABASE_URL=
ADMIN_TOKEN=
MOCK_WECHAT_PAY=false
WECHAT_APP_ID=
WECHAT_APP_SECRET=
WECHAT_MCH_ID=
WECHAT_MCH_SERIAL_NO=
WECHAT_API_V3_KEY=
WECHAT_PRIVATE_KEY_PATH=
WECHAT_PAY_NOTIFY_URL=
WECHAT_REFUND_NOTIFY_URL=
```

## 数据库备份

每天至少一次：

```bash
pg_dump "$DATABASE_URL" > backups/community_selection_$(date +%F).sql
```

## 小程序发布前检查

1. API 域名已备案和 HTTPS。
2. 微信小程序后台配置 request 合法域名。
3. 微信支付商户号已配置。
4. 支付回调域名可访问。
5. 退款回调域名可访问。
6. MOCK_WECHAT_PAY=false。
7. 生产环境 ADMIN_TOKEN 足够复杂。
8. 数据库已备份。

## 灰度上线建议

先只开放：

- 1 个门店
- 3 个社区
- 20 个 SKU
- 3 个开团爆款
- 5 个开团人

观察 7 天：

- 成团率
- 支付成功率
- 退款率
- 售后率
- 奖励结算准确率
- 分拣错误率
