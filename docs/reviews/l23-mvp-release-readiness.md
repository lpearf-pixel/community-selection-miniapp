# L23 MVP 发布前验收与内测准备 Review

## 本阶段目标

L23 在 L22 小程序订单中心完成后进入 MVP 发布前收口，补齐文档、环境配置说明、手工验收清单、自动验收脚本和发布前合规检查。

## 本阶段不新增业务能力

本阶段不新增购物车、营销玩法、真实支付、自动退款、自动打款、自动报税，也不新增 DB 字段。

## MVP 主链路

MVP 主链路覆盖商品浏览、社区选择、自提点选择、普通购买、开团购买、mock 支付、订单中心、自提凭证、售后申请、售后进度，以及后台财务/运营查看。

## 文档清单

- `docs/release/mvp-checklist.md`
- `docs/release/miniapp-devtools-test-guide.md`
- `docs/release/env-config.md`
- `docs/release/known-limitations.md`

## 自动验收脚本

新增 `scripts/verify-l23-mvp-release-readiness-local.ts`，覆盖文档存在性、关键词、小程序路由、源码安全扫描、后端 API smoke test 和合规扫描。

## 小程序 DevTools 人工验收

使用微信开发者工具打开小程序，按手工指南设置 API_BASE_URL、mock 用户、社区和自提点，然后依次验证商品、下单、mock 支付、订单、自提凭证和售后进度。

## 环境配置

本地后端建议使用 `API_HOST=127.0.0.1`、`API_PORT=13080`、`WECHAT_PAY_MODE=mock`、`MOCK_WECHAT_PAY=true`、`AUTO_PAYOUT_ENABLED=false`、`AUTO_TAX_FILING_ENABLED=false`。

## 已知限制

当前仍使用 mock payment、mock user identity、手动设置 API_BASE_URL、手动选择社区和自提点。真实支付、HTTPS、合法域名、隐私政策、用户协议和客服/售后规则文案需上线前专项补齐。

## 合规边界

不接真实微信支付，不新增营销玩法，不新增多层级关系，不新增 DB 字段，不暴露成本价、奖励配置或完整手机号。

## 后续建议

- L24 购物车。
- L25 真实支付准备。
- L26 上线安全合规。
