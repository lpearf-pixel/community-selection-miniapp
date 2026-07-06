# 阶段验收报告：L20

## 1. 阶段结论

- 阶段：L20
- 分支：codex/create-l19-branch-for-product-purchase-entry-6go43g
- 生成时间：2026-07-06T04:52:02.408Z
- 当前 commit：353f249fee7cb3957424c883c8d542693b22e2ab
- 本阶段目标：L20 阶段目标，需结合阶段说明人工确认
- Codex 自评结论：passed

## 2. 本阶段变更范围

本报告基于 L20 stage manifest 与 latest verify output 生成，用于覆盖当前阶段范围。

| 类型 | 文件 | 说明 |
|---|---|---|
| Other | apps/miniapp/utils/api.js | 其他变更 |
| Other | apps/miniapp/utils/user.js | 其他变更 |
| Other | apps/miniapp/app.js | 其他变更 |
| Other | apps/miniapp/app.json | 其他变更 |
| Other | apps/miniapp/pages/join-order/index.js | 其他变更 |
| Other | apps/miniapp/pages/products/index.js | 其他变更 |
| Other | apps/miniapp/pages/products/index.wxml | 其他变更 |
| Other | apps/miniapp/pages/product-detail/index.js | 其他变更 |
| Other | apps/miniapp/pages/product-detail/index.wxml | 其他变更 |
| Other | apps/miniapp/pages/orders/confirm/index.js | 其他变更 |
| Other | apps/miniapp/pages/orders/confirm/index.wxml | 其他变更 |
| Other | apps/miniapp/pages/orders/detail/index.js | 其他变更 |
| Other | apps/miniapp/pages/orders/detail/index.wxml | 其他变更 |
| Other | apps/miniapp/pages/pickup/code/index.js | 其他变更 |
| Other | apps/miniapp/pages/pickup/code/index.wxml | 其他变更 |
| Other | apps/miniapp/pages/after-sales/apply/index.js | 其他变更 |
| Other | apps/miniapp/pages/after-sales/apply/index.wxml | 其他变更 |
| Other | apps/miniapp/pages/after-sales/detail/index.js | 其他变更 |
| Other | apps/miniapp/pages/after-sales/detail/index.wxml | 其他变更 |
| Script | scripts/verify-l20-miniapp-e2e-release-local.ts | 验收、检查或工具脚本 |
| Docs | docs/reviews/l20-miniapp-e2e-release.md | 文档或 review 说明 |

## 3. API 变化

| 方法 | 路径 | 权限 | 用途 | 是否有验收 |
|---|---|---|---|---|
| GET | /api/products | public | 用户端商品浏览与可参与开团 | yes |
| GET | /api/products/:id | public | 用户端商品浏览与可参与开团 | yes |
| GET | /api/products/:id/group-buys | public | 用户端商品浏览与可参与开团 | yes |
| POST | /api/orders/normal | public | 订单管理 | yes |
| POST | /api/orders | public | 订单管理 | yes |
| POST | /api/payments/mock | public | mock 支付 | yes |
| GET | /api/me/orders/:id | user identity | 用户订单中心 | yes |
| GET | /api/me/orders/:id/pickup-code | user identity | 用户订单中心 | yes |
| POST | /api/me/orders/:id/after-sales | user identity | 用户订单中心 | yes |
| GET | /api/me/orders/:id/after-sales | user identity | 用户订单中心 | yes |

## 4. 数据库变化

| Model | 新增/修改 | 说明 |
|---|---|---|
| 无新增表 | L20 manifest | L20 小程序端端到端联调与发布前收口阶段数据库范围 |
| 无新增字段 | L20 manifest | L20 小程序端端到端联调与发布前收口阶段数据库范围 |

## 5. 核心业务验收点

- [x] 小程序商品列表页接入真实 API
- [x] 小程序商品详情页接入真实 API
- [x] 小程序下单确认页支持普通购买
- [x] 小程序下单确认页支持开团购买
- [x] mock 支付后可跳转订单详情
- [x] 订单详情页接入真实 API
- [x] 自提凭证页接入真实 API
- [x] 售后申请页接入真实 API
- [x] 售后详情页接入真实 API
- [x] loading / error / empty 状态覆盖
- [x] 不调用 wx.requestPayment
- [x] 不接真实微信支付
- [x] 不暴露成本价
- [x] 不暴露奖励配置
- [x] 不新增优惠券/会员/裂变玩法
- [x] 不新增自动退款
- [x] 不新增自动打款
- [x] 不新增自动报税
- [x] 合规扫描通过

## 6. 验收脚本

| 脚本 | 是否存在 | 是否已加入 verify-all | 说明 |
|---|---|---|---|
| scripts/verify-l20-miniapp-e2e-release-local.ts | yes | yes | L20 小程序端端到端联调与发布前收口阶段验收脚本；pnpm verify:all 必须覆盖 |
| pnpm verify:all | yes | yes | L20 manifest 要求的总体验证命令 |

## 7. 本地命令执行结果

| 命令 | 结果 |
|---|---|
| pnpm typecheck | passed |
| pnpm lint | passed |
| pnpm test | passed |
| pnpm build | passed |
| pnpm compliance:scan | not found |
| pnpm verify:all | passed |

## 8. 合规边界检查

- [x] 没有新增多级分销
- [x] 没有新增团队收益
- [x] 没有新增代理收益
- [x] 没有新增 parent_leader_id / upline_id / downline / team_id / level
- [x] 开团服务奖励仍只来自开团人自己的真实有效团购订单
- [x] 用户可见文案仍为“开团服务奖励”
- [x] 没有接真实打款
- [x] 没有自动报税
- [x] 没有新增优惠券/会员/营销玩法，除非当前阶段明确要求

## 9. 风险点

- 高风险：暂无自动发现，需人工 review
- 中风险：暂无自动发现，需人工 review
- 低风险：报告生成器基于 git diff 和文本扫描，API 用途/验收状态可能需要人工复核。

## 10. 未完成项

暂无自动发现，需人工 review

## 11. Codex 给人工 reviewer 的说明

- 本阶段做了什么：本报告基于 L20 stage manifest 与 latest verify output 生成，用于覆盖当前阶段范围，自动汇总文件范围、API、数据库模型、验收脚本、本地命令输出、合规边界和风险点。
- 确定完成：报告文件已生成；若 git 信息可用，则已自动带出分支、commit 与文件清单。
- 需要人工重点看：API 用途、核心验收点、风险点和未完成项均为文本启发式结果，应结合 PR diff 和实际 verify 输出复核。
- 是否建议进入下一阶段：仅当 verify-all、合规扫描和人工 review 均通过后再进入下一阶段。
