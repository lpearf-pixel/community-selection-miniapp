# 02 技术架构

## 总体架构

```text
微信小程序 apps/miniapp
        ↓ HTTPS
Fastify API apps/api
        ↓ Prisma
PostgreSQL

React 管理后台 apps/admin
        ↓ HTTPS
Fastify API apps/api
```

## 技术选型

| 模块 | 技术 |
|---|---|
| 小程序端 | 微信原生小程序 |
| 后端 API | Node.js + TypeScript + Fastify |
| ORM | Prisma |
| 数据库 | PostgreSQL |
| 后台 | React + Vite + Ant Design |
| 包管理 | pnpm workspace |
| 部署 | Docker Compose |
| 支付 | 微信支付 JSAPI，第一版支持 MOCK |
| 退款 | 微信支付退款，第一版支持 MOCK |

## 为什么不使用重型架构

第一版业务重点是跑通实体店私域交易闭环，不需要微服务、Kubernetes、MQ、Redis、Elasticsearch。所有异步任务用数据库任务表或定时扫描即可。

## 目录结构

```text
community-selection-miniapp/
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── app.ts
│   │   │   ├── server.ts
│   │   │   ├── env.ts
│   │   │   ├── plugins/
│   │   │   ├── routes/
│   │   │   ├── services/
│   │   │   ├── jobs/
│   │   │   └── tests/
│   │   └── package.json
│   ├── admin/
│   │   ├── src/
│   │   └── package.json
│   └── miniapp/
│       ├── app.js
│       ├── app.json
│       ├── app.wxss
│       ├── config.js
│       └── pages/
├── packages/
│   ├── shared/
│   └── config/
├── prisma/
│   ├── schema.prisma
│   └── seed.ts
├── docs/
├── scripts/
└── docker-compose.yml
```

## 环境变量

```env
NODE_ENV=development
PORT=13080
DATABASE_URL=postgresql://postgres:postgres@localhost:15432/community_selection
ADMIN_TOKEN=dev-admin-token
MOCK_WECHAT_PAY=true

WECHAT_APP_ID=
WECHAT_APP_SECRET=
WECHAT_MCH_ID=
WECHAT_MCH_SERIAL_NO=
WECHAT_API_V3_KEY=
WECHAT_PRIVATE_KEY_PATH=
WECHAT_PAY_NOTIFY_URL=
WECHAT_REFUND_NOTIFY_URL=
```

## 金额规范

所有金额内部使用整数分：

```ts
priceCents: 2990 // 29.90 元
```

前端展示时格式化：

```ts
function formatMoney(cents: number) {
  return (cents / 100).toFixed(2)
}
```

## API 响应规范

```ts
type ApiSuccess<T> = {
  success: true
  data: T
  message: string
}

type ApiFailure = {
  success: false
  data: null
  message: string
}
```

## 鉴权策略

第一版：

- 小程序用户：微信登录，MOCK 模式可返回测试 openid。
- 后台管理：使用 `ADMIN_TOKEN` 做简单鉴权。

后续再升级为完整账号密码、RBAC 和操作审计。

## 定时任务

第一版需要：

1. 每分钟扫描过期未成团的团购。
2. 每分钟扫描退款处理中状态。
3. 每天凌晨将满足条件的奖励从 pending 转 available。

## 部署原则

第一阶段推荐一台 2C4G 云服务器即可：

- api
- admin 静态资源
- postgres
- nginx

第一版图片可先本地存储，后续接 COS/OSS。
