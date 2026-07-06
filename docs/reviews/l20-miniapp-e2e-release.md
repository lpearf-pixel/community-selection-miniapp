# L20 小程序端端到端联调发布就绪 Review

## 范围

L20 只覆盖微信小程序端从商品浏览到下单、MOCK 支付、订单详情、自提凭证、售后申请和售后进度的端到端联调发布就绪改动。

## 验收点

- 商品列表和商品详情继续复用 L19 已合并的公开商品 API。
- 普通购买与参与社区团购均进入统一确认订单页。
- 下单后只调用 MOCK 支付接口，不调用 `wx.requestPayment`，不接真实微信支付。
- 用户可从订单详情进入自提凭证和售后申请。
- 售后申请后可查看售后进度。
- 不新增数据库表、Prisma schema、migration、不符合本阶段范围的营销或多层级收益逻辑。

## 本地验证

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
bash scripts/local-verify.sh
pnpm report:stage -- --stage=L20
```

验收脚本通过时输出：

- `L20 miniapp e2e release verification passed.`
- `Compliance scan passed.`
