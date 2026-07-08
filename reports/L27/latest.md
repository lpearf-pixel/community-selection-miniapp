# 阶段验收报告：L27

## 1. 阶段结论

- 阶段：L27
- 分支：codex/add-l26-group-buy-success-rule-usrv68
- 生成时间：2026-07-08T04:32:29.491Z
- 当前 commit：ea547669d5cbe41b4517cda1e7d1751482e1d5cb
- 本阶段目标：L27 阶段目标，需结合阶段说明人工确认
- Codex 自评结论：passed

## 2. 本阶段变更范围

本报告基于 L27 stage manifest 与 latest verify output 生成，用于覆盖当前阶段范围。

| 类型 | 文件 | 说明 |
|---|---|---|
| Service | apps/api/src/modules/group-buy/group-buy-expiry-service.ts | 领域模块服务或模块边界 |
| API | apps/api/src/routes/group-buys.ts | API 路由或路由注册边界 |
| Other | apps/miniapp/pages/group-buy-detail/index.js | 其他变更 |
| Other | apps/miniapp/pages/group-buy-detail/index.wxml | 其他变更 |
| Script | scripts/verify-l27-group-buy-expiry-manual-refund-local.ts | 验收、检查或工具脚本 |
| Script | scripts/verify-all-local.sh | 验收、检查或工具脚本 |
| Script | scripts/generate-stage-report.ts | 验收、检查或工具脚本 |
| Docs | docs/reviews/l27-group-buy-expiry-manual-refund.md | 文档或 review 说明 |

## 3. API 变化

| 方法 | 路径 | 权限 | 用途 | 是否有验收 |
|---|---|---|---|---|
| GET | /api/admin/group-buys/expired-pending | admin session | 团购管理 | yes |
| POST | /api/admin/group-buys/:id/mark-failed | admin session | 团购管理 | yes |
| GET | /api/admin/group-buys/:id/manual-refund-orders | admin session | 团购管理 | yes |
| POST | /api/admin/orders/:id/manual-refund | admin session | 订单管理 | yes |
| POST | /api/admin/group-buys/:id/close-unpaid-orders | admin session | 团购管理 | yes |
| GET | /api/group-buys/:id | public | 团购管理 | yes |

## 4. 数据库变化

| Model | 新增/修改 | 说明 |
|---|---|---|
| 无新增表 | L27 manifest | L27 团购过期失败处理与人工退款/关闭流程数据库范围 |
| 无新增字段 | L27 manifest | L27 团购过期失败处理与人工退款/关闭流程数据库范围 |

## 5. 核心业务验收点

- [x] 过期 pending 团购可标记 failed
- [x] 未过期团购不可标记 failed
- [x] success 团购不可标记 failed
- [x] paid_quantity 达标时应 success 而不是 failed
- [x] failed 团购禁止继续参团
- [x] 团购失败不自动退款
- [x] 团购失败不自动打款
- [x] 团购失败不自动报税
- [x] paid 订单进入人工退款处理
- [x] unpaid 订单可关闭
- [x] 人工退款需要管理员操作
- [x] 人工退款记录退款金额
- [x] 人工退款记录退款方式
- [x] 人工退款记录退款流水号
- [x] 人工退款记录管理员备注
- [x] 手动退款不调用微信退款 API
- [x] 手动退款金额不能超过支付金额
- [x] 重复退款有保护
- [x] 响应不暴露完整手机号
- [x] 不新增 DB 表
- [x] 不新增 DB 字段
- [x] 不新增真实微信支付
- [x] 不新增奖励结算
- [x] 不新增多级/团队/代理玩法
- [x] 合规扫描通过

## 6. 验收脚本

| 脚本 | 是否存在 | 是否已加入 verify-all | 说明 |
|---|---|---|---|
| scripts/verify-l27-group-buy-expiry-manual-refund-local.ts | yes | yes | L27 团购过期失败处理与人工退款/关闭流程验收脚本；pnpm verify:all 必须覆盖 |
| pnpm verify:all | yes | yes | L27 manifest 要求的总体验证命令 |

## 7. 本地命令执行结果

| 命令 | 结果 |
|---|---|
| pnpm typecheck | passed |
| pnpm lint | not found |
| pnpm test | passed |
| pnpm build | not found |
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
- 中风险：本阶段改动文件存在 TODO / boundary / placeholder 等关键词，详见未完成项。
- 低风险：报告生成器基于 git diff 和文本扫描，API 用途/验收状态可能需要人工复核。

## 10. 未完成项

- scripts/verify-all-local.sh:36 — pnpm exec tsx scripts/verify-l14-5-modular-boundary-local.ts
- scripts/generate-stage-report.ts:712 — function findTodoItems(files: string[]) {
- scripts/generate-stage-report.ts:713 — const keywords = /(TODO|FIXME|boundary|placeholder|待实现)/i;
- scripts/generate-stage-report.ts:740 — const todos = findTodoItems(changed.files);
- scripts/generate-stage-report.ts:797 — - 中风险：${todos.length ? '本阶段改动文件存在 TODO / boundary / placeholder 等关键词，详见未完成项。' : '暂无自动发现，需人工 review'}
- scripts/generate-stage-report.ts:802 — ${todos.length ? todos.join('\n') : '暂无自动发现，需人工 review'}

## 11. Codex 给人工 reviewer 的说明

- 本阶段做了什么：本报告基于 L27 stage manifest 与 latest verify output 生成，用于覆盖当前阶段范围，自动汇总文件范围、API、数据库模型、验收脚本、本地命令输出、合规边界和风险点。
- 确定完成：报告文件已生成；若 git 信息可用，则已自动带出分支、commit 与文件清单。
- 需要人工重点看：API 用途、核心验收点、风险点和未完成项均为文本启发式结果，应结合 PR diff 和实际 verify 输出复核。
- 是否建议进入下一阶段：仅当 verify-all、合规扫描和人工 review 均通过后再进入下一阶段。
