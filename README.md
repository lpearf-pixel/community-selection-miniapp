# 社区甄选小程序

这是一个面向本地实体店、微信群和社区团购场景的轻量微信小程序项目。

## 业务定位

本项目不是大而全商城，而是：

> 实体店私域小程序 + 社区开团 + 一级开团服务奖励 + 自提配送 + 微信支付退款闭环。

已有条件：

- 线下实体店
- 线下货源
- 美团门店
- 微信群

需要补齐：

- 微信小程序
- 商品下单
- 社区团购
- 开团失败自动退款
- 退款售后
- 一级开团服务奖励
- 后台管理
- 自动验收测试

## Codex 使用方式

在 Web Codex 中打开本仓库后，先阅读：

1. `AGENTS.md`
2. `docs/00_PROJECT_BRIEF.md`
3. `docs/08_CODEX_TASKS.md`
4. `docs/09_ACCEPTANCE_TESTS.md`

然后执行：

```text
请读取 AGENTS.md 和 docs/08_CODEX_TASKS.md，先执行阶段 1：初始化项目骨架。每完成一个阶段必须运行 scripts/check.sh，测试失败不要继续下一阶段。
```

## 推荐技术栈

- 小程序端：微信原生小程序
- 后端：Node.js + TypeScript + Fastify
- 数据库：PostgreSQL
- ORM：Prisma
- 管理后台：React + Vite + Ant Design
- 部署：Docker Compose
- 支付：微信支付 JSAPI
- 退款：微信支付退款接口
- 第一版缓存：不加 Redis
- 第一版队列：不用 MQ，用数据库任务表和定时扫描

## 第一版核心闭环

1. 用户微信登录
2. 浏览商品
3. 发起或参与团购
4. 创建订单
5. 微信支付或 MOCK 支付
6. 达到成团条件后成团
7. 未成团自动退款
8. 门店自提/配送
9. 售后退款
10. 一级开团服务奖励
11. T+7 后奖励可提现
12. 后台人工审核提现

## 合规原则

只做一级开团服务奖励，不做分销系统。

必须避免：

- 二级返佣
- 三级返佣
- 团队收益
- 下级收益
- 加盟费
- 资格费
- 买礼包成为开团人
- 拉人头奖励
- 收益承诺

## 开发阶段

详见 `docs/08_CODEX_TASKS.md`。

## 自动验收

详见 `docs/09_ACCEPTANCE_TESTS.md`。

自建 GitHub Actions Runner 的环境契约、Admin E2E 拓扑、验证顺序与排障清单见 [`docs/self-hosted-runner.md`](docs/self-hosted-runner.md)。

## 小程序主题开发规范

小程序端 19 个页面共用同一套主题令牌、共享组件和换肤门禁。新增页面或切换模板前，请先阅读 [`docs/architecture/miniapp-global-theme-system.md`](docs/architecture/miniapp-global-theme-system.md)。后台管理端主题化不在 L50 阶段范围内。

计划脚本：

```bash
scripts/check.sh
scripts/e2e-smoke.sh
scripts/e2e-refund.sh
scripts/e2e-group-failed.sh
```
