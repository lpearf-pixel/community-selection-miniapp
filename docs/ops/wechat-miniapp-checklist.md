# 微信小程序配置清单

- 小程序 AppID 与后端 `WECHAT_APP_ID` 一致。
- request 合法域名包含生产 API HTTPS 域名。
- upload/download 合法域名按实际使用补充。
- 体验版先验证登录、商品列表、开团、下单、支付 MOCK、订单状态展示。
- 切换真实微信支付前，必须先完成 `docs/ops/wechat-pay-switch-checklist.md`。
- 小程序内用户可见文案统一使用“开团服务奖励”。
