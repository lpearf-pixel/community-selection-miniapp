# L46 Admin 经营驾驶舱 V2 设计

## 目标
为运营、财务和管理人员提供只读的经营总览：订单成交、团购、履约、售后、库存、开团服务奖励、提现、税务人工 Review、趋势和风险提醒。所有金额均为整数分；不执行任何业务动作。

## 用户角色
`super_admin` 可查看全域。运营、门店、商品和售后角色可查看 Operations；财务、退款、奖励和提现角色可查看 Finance。inactive 用户未认证。

## 指标与时间字段
* 已支付订单/GMV：`pay_status=paid`，以 `paid_at` 落在半开区间 `[from,to)`；GMV 是 `pay_amount_cents` 求和。
* 成功退款：沿用退款成功状态和退款财务金额，以成功时间落在区间；净收款为 GMV 减成功退款，负值保留为 warning evidence。
* 团购状态分别按现有 active/success/failed/expired pending 状态；履约待办使用既有订单履约字段；售后仅为待人工处理的 AfterSaleCase。
* 低库存使用 L46 常量阈值（响应带回阈值）；临期批次使用既有过期日，默认未来 7 天且仅允许 1–30 天。
* 奖励、提现、税务使用既有 Commission、RewardLedger、Withdrawal、TaxRecord 状态，不重复推导。

## 权限矩阵与数据范围
Operations 要求任一 `operations.view`、`order.view`、`pickup.verify`、`after_sale.manage`、`product.manage`；Finance 要求任一 `finance.view`、`refund.view`、`reward.view`、`withdrawal.view`。无该 section 权限返回 `{available:false,reason:"permission_denied"}`，绝不以 0 代替。

身份由正式 session 优先解析；生产环境不接受 header mock；无 session 时非生产才可用 header mock。使用 `resolveAdminAccessContext`、`resolveAdminDataScope`、`requireAdminPermission`、`hasAdminPermission`、`withdrawalScopeWhere`、`canAccessOrderDataScope`。非 super_admin 仅限授权社区/自提点；未配置 scope 为空；筛选与 scope 求交集，明确越权单资源返回 403。

## API 契约
* `GET /api/admin/dashboard-v2/overview`：ISO `from/to`、`community_id`、`pickup_store_id`、`timezone`（默认 Asia/Shanghai）；最大 93 天，`from>=to` 为 400，超限 422；返回实际 period、scope、两个权限 section 与整数分指标。
* `GET /api/admin/dashboard-v2/trends`：同筛选，最多 31 天；数据库按自然日聚合，补零且日期升序稳定。
* `GET /api/admin/dashboard-v2/alerts`：只读，默认 50、最大 100；稳定按 severity、occurred_at、target_id；仅跳既有后台页面且不含敏感资料。

## 页面结构
筛选器、Operations/Finance KPI 卡、简单 SVG/CSS 趋势、提醒、更新时间及 scope。明确展示 section 无权限；支持 loading/empty/error/retry；使用既有 client 和金额格式化，并用 AbortController/请求序号避免陈旧状态写入。

## 性能边界
聚合在数据库完成，趋势不在应用层扫描订单。TaxRecord 列表、导出与 dashboard 税务聚合以数据库 `EXISTS/JOIN` 参数化查询处理 withdrawal scope；不得生成可见 withdrawal ID 的大 IN 列表。alerts 最多 100。

## 风险
历史数据可能造成净收款为负，保留 warning evidence。泛型 TaxRecord source_id 无外键，需窄 repository 保持现有过滤语义。时区日界以请求 timezone 明确处理。

## 测试计划
静态 verifier、Docker E2E 以 A/B 社区及各身份验证 scope、权限、日界、补零、稳定排序、无敏感字段、只读和 tax 数据库查询；300 条 withdrawal/TaxRecord 回归 list/count/export/dashboard 一致；L24–L46 chain、raw scan、Admin typecheck。

## 明确不做
不做自动打款、报税、审核、退款、采购或调库存；不接第三方 BI/税务/银行/配送平台；不做 L47 功能或任何多级收益。

## Product and batch scope basis

Product and ProductBatch inventory metrics use `related_group_buy` scope basis. A product is visible only when it has at least one GroupBuy visible to the effective admin scope; batches inherit that product scope. Products without a scoped GroupBuy fail closed. This is not a store-level independent inventory claim: `Product.stock` remains a global product field. Super administrators see all products only without an explicit filter; explicit filters use related GroupBuy scope.
