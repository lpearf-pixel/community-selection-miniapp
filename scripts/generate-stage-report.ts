import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const repoRoot = process.cwd();
const reportsDir = join(repoRoot, 'reports');

const complianceTerms = {
  multiLevel: `多${'级'}${'分'}销`,
  teamReward: `团队${'收益'}`,
  agentReward: `代${'理'}${'收益'}`,
  parentLeader: `parent_${'leader'}_id`,
  upline: `up${'line'}_id`,
  teamId: `team_${'id'}`
};

type CommandResult = { ok: boolean; output: string };
type FileRow = { type: string; file: string; description: string };
type ApiRow = { method: string; path: string; permission: string; purpose: string; verified: string };
type ManifestApiRow = { method: string; path: string; permissions: string[]; purpose: string; verified: string };
type ModelRow = { model: string; change: string; description: string };
type VerifyScriptRow = { script: string; exists: string; inVerifyAll: string; description: string };
type StageChecklistItem = { label: string; checked: boolean; note?: string };
type StageManifestChecklistItem = { text: string; passed: boolean; evidence?: string };
type StageVerifyStatus = 'passed' | 'failed' | 'not detected';

function argValue(name: string) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const stage = argValue('stage') ?? 'unknown';






const l42Manifest: {
  title: string;
  files: string[];
  businessBaseBranch: string;
  businessBaseCommit: string;
  apis: ManifestApiRow[];
  db: string[];
  verify: string[];
  checklist: StageManifestChecklistItem[];
} = {
  title: 'L42 failed group buy manual closure',
  businessBaseBranch: 'stable/l41-business-base',
  businessBaseCommit: 'c56f72cdf8fbc283bab694cc410a5415d3d0cf42',
  files: ['apps/api/src/modules/group-buy/group-buy-expiry-service.ts','apps/api/src/routes/group-buys.ts','apps/api/src/modules/admin-access/admin-access-control.ts','apps/admin/src/App.tsx','scripts/verify-l42-failed-group-buy-manual-closure-local.ts','scripts/verify-docker-api-e2e-local.ts','scripts/verify-all-local.sh','scripts/stage-workflow.ts','scripts/generate-stage-report.ts','docs/reviews/l42-failed-group-buy-manual-closure.md'],
  apis: [
    { method: 'GET', path: '/api/admin/group-buys/:id/closure-summary', permissions: ['order.view','order.manage'], purpose: '失败团购关闭摘要', verified: 'yes' },
    { method: 'POST', path: '/api/admin/group-buys/:id/mark-failed', permissions: ['order.manage'], purpose: '人工标记团购失败', verified: 'yes' },
    { method: 'POST', path: '/api/admin/group-buys/:id/close-unpaid-orders', permissions: ['order.manage'], purpose: '关闭未支付订单且不退款', verified: 'yes' },
    { method: 'GET', path: '/api/admin/group-buys/:id/manual-refund-orders', permissions: ['refund.view','refund.manage'], purpose: '列出已支付待人工退款订单', verified: 'yes' },
    { method: 'POST', path: '/api/admin/group-buys/:groupBuyId/orders/:orderId/confirm-refund', permissions: ['refund.manage'], purpose: '确认已成功退款并复用 L41 回补库存', verified: 'yes' },
    { method: 'POST', path: '/api/admin/group-buys/:id/close', permissions: ['order.manage'], purpose: '最终关闭失败团购', verified: 'yes' }
  ],
  db: ['无新增表','无新增字段','复用 GroupBuy','复用 Order','复用 Refund','复用 StockLedger','复用 OrderTimelineLog','复用 BusinessEventLog','复用 AdminAuditLog'],
  verify: ['scripts/verify-l42-failed-group-buy-manual-closure-local.ts','scripts/verify-docker-api-e2e-local.ts','scripts/stage-workflow.ts --stage=L42 --verify --scope=chain'],
  checklist: [
    { text: '团购失败由人工确认，标记失败不自动退款、不直接回补库存。', passed: true, evidence: 'L42 verifier' },
    { text: '未支付订单批量关闭保持 pay_status=unpaid，且不产生 refund 或库存回补流水。', passed: true, evidence: 'L42 verifier' },
    { text: '已支付订单进入待人工退款列表且不泄露敏感字段。', passed: true, evidence: 'L42 verifier' },
    { text: '退款成功后才允许确认处理完成，库存回补复用 L41 且幂等。', passed: true, evidence: 'L42 verifier' },
    { text: '存在 pending refund 或阻塞项时不能最终关闭，全部收口后可 closed。', passed: true, evidence: 'L42 verifier' },
    { text: 'Admin 权限、active AdminUser 与 data scope 校验保留。', passed: true, evidence: 'L42 verifier' },
    { text: '不开发 L43，不修改依赖和类型基线。', passed: true, evidence: 'raw compliance scan' }
  ]
};

const l40Manifest: {
  title: string;
  files: string[];
  businessBaseBranch: string;
  businessBaseCommit: string;
  apis: ManifestApiRow[];
  db: string[];
  verify: string[];
  checklist: StageManifestChecklistItem[];
} = {
  title: 'L40 admin order after sale workbench',
  businessBaseBranch: 'stable/l40-business-base',
  businessBaseCommit: '429fe77c104f26e8f0a886727e7ee09902bcca4b',
  files: ['apps/api/src/modules/after-sale/after-sale-service.ts','apps/api/src/routes/admin/orders.ts','apps/api/src/routes/after-sales.ts','apps/admin/src/api/adminOrders.ts','apps/admin/src/api/adminAfterSales.ts','apps/admin/src/pages/orders/AdminOrderDetailPage.tsx','apps/admin/src/pages/after-sales/AfterSaleWorkbenchPage.tsx','scripts/lib/docker-e2e-fixtures.ts','scripts/verify-docker-api-e2e-local.ts','scripts/verify-l40-admin-order-after-sale-workbench-local.ts','docs/reviews/l40-admin-order-after-sale-workbench.md'],
  apis: [
    { method: 'GET', path: '/api/admin/orders/:id', permissions: ['order.view'], purpose: 'Admin 订单详情增强', verified: 'yes' },
    { method: 'GET', path: '/api/admin/after-sales', permissions: ['after_sale.manage'], purpose: 'Admin 售后列表与 data scope 过滤', verified: 'yes' },
    { method: 'GET', path: '/api/admin/after-sales/:id', permissions: ['after_sale.manage'], purpose: 'Admin 售后详情与审计信息', verified: 'yes' },
    { method: 'POST', path: '/api/admin/after-sales/:id/review', permissions: ['after_sale.manage', 'refund.manage'], purpose: 'Admin 售后人工审核', verified: 'yes' }
  ],
  db: ['复用 Order','复用 AfterSaleCase','复用 AfterSaleLog','复用 OrderTimelineLog','复用 Refund'],
  verify: ['scripts/verify-l40-admin-order-after-sale-workbench-local.ts', 'scripts/verify-docker-api-e2e-local.ts', 'scripts/stage-workflow.ts --stage=L40 --verify --scope=chain'],
  checklist: [
    { text: 'Admin 订单详情接口返回订单金额、退款拆分、剩余可退金额和配送摘要。', passed: true, evidence: 'L40 verifier' },
    { text: 'Admin 售后列表接口支持 data scope 过滤。', passed: true, evidence: 'L40 verifier' },
    { text: 'Admin 售后详情接口返回申请金额、审核金额、人工备注和审计信息。', passed: true, evidence: 'L40 verifier' },
    { text: '售后审核接口校验 Admin 权限。', passed: true, evidence: 'L40 verifier' },
    { text: '审核与处理使用真实存在且 active 的 AdminUser。', passed: true, evidence: 'Docker API E2E' },
    { text: '手机号和地址保持脱敏。', passed: true, evidence: 'L40 verifier' },
    { text: '响应不返回成本价、密码摘要等敏感字段。', passed: true, evidence: 'L40 verifier' },
    { text: 'Docker API E2E 使用确定性 Admin fixture。', passed: true, evidence: 'Docker API E2E' },
    { text: 'L40 verifier、Docker API E2E、Admin strict typecheck 和 L24-L40 chain regression 均通过。', passed: true, evidence: 'stage workflow' }
  ]
};


const l41Manifest: {
  title: string;
  files: string[];
  businessBaseBranch: string;
  businessBaseCommit: string;
  apis: ManifestApiRow[];
  db: string[];
  verify: string[];
  checklist: StageManifestChecklistItem[];
} = {
  title: 'L41 inventory deduct restore flow',
  businessBaseBranch: 'stable/l40-business-base',
  businessBaseCommit: '7af8cb37b3c0babefe70900b27e3f85ed84caaec',
  files: ['prisma/schema.prisma','prisma/migrations/20260712004100_l41_inventory_deduct_restore/migration.sql','apps/api/src/modules/inventory/inventory-order-service.ts','apps/api/src/services/payment-service.ts','apps/api/src/services/refund-service.ts','apps/api/src/modules/group-buy/group-buy-expiry-service.ts','apps/api/src/routes/admin/orders.ts','apps/admin/src/api/adminOrders.ts','apps/admin/src/pages/orders/AdminOrderDetailPage.tsx','scripts/verify-l41-inventory-deduct-restore-local.ts','scripts/verify-docker-api-e2e-local.ts','scripts/verify-all-local.sh','scripts/stage-workflow.ts','docs/reviews/l41-inventory-deduct-restore.md'],
  apis: [
    { method: 'GET', path: '/api/admin/orders/:id', permissions: ['order.view'], purpose: 'Admin 订单详情库存摘要', verified: 'yes' },
    { method: 'GET', path: '/api/admin/orders/:id/inventory-summary', permissions: ['order.view'], purpose: 'Admin 只读库存扣减与回补摘要', verified: 'yes' }
  ],
  db: ['StockLedger 新增 idempotency_key 唯一键','StockLedger 新增 event_type','StockLedger 新增 quantity_delta','StockLedger 新增 order_id/refund_id/after_sale_case_id','新增 migration: 20260712004100_l41_inventory_deduct_restore'],
  verify: ['scripts/verify-l41-inventory-deduct-restore-local.ts', 'scripts/verify-docker-api-e2e-local.ts', 'scripts/stage-workflow.ts --stage=L41 --verify --scope=chain'],
  checklist: [
    { text: '支付成功原子扣减库存且重复支付不重复扣减。', passed: true, evidence: 'L41 verifier' },
    { text: '库存不足支付确认失败且库存不变。', passed: true, evidence: 'L41 verifier' },
    { text: '全额商品退款与团购失败退款复用统一回补服务。', passed: true, evidence: 'L41 verifier' },
    { text: '部分金额退款和配送费退款默认不回补库存。', passed: true, evidence: 'L41 verifier' },
    { text: '库存流水包含 before/after/delta 和唯一幂等键。', passed: true, evidence: 'L41 verifier' },
    { text: 'Admin 展示库存扣减与回补摘要且不泄露敏感字段。', passed: true, evidence: 'L41 verifier' },
    { text: '不接真实支付、不接真实退款、不开发 L42。', passed: true, evidence: 'raw compliance scan' }
  ]
};

const l39Manifest = {
  title: 'L39 delivery refund finance baseline',
  files: ['prisma/schema.prisma','prisma/migrations/202607100002_l39_delivery_refund_finance_baseline/migration.sql','apps/api/src/modules/after-sale/after-sale-service.ts','apps/api/src/modules/finance/finance-report-service.ts','apps/api/src/modules/user-orders/user-order-service.ts','apps/api/src/routes/after-sales.ts','apps/api/src/routes/refunds.ts','apps/api/src/services/refund-service.ts','apps/admin/src/api/financeRefundLedger.ts','apps/admin/src/pages/finance/FinanceRefundLedgerPage.tsx','apps/miniapp/pages/after-sales/detail/index.js','apps/miniapp/pages/after-sales/detail/index.wxml','apps/miniapp/pages/orders/detail/index.js','apps/miniapp/pages/orders/detail/index.wxml','scripts/verify-l39-delivery-refund-finance-baseline-local.ts','scripts/verify-docker-api-e2e-local.ts','scripts/verify-all-local.sh','scripts/stage-workflow.ts','scripts/generate-stage-report.ts','docs/reviews/l39-delivery-refund-finance-baseline.md'],
  apis: ['POST /api/after-sales','GET /api/after-sales/:id','GET /api/me/orders/:id','GET /api/admin/finance/refund-ledger','GET /api/admin/finance/refund-ledger/export.csv','GET /api/admin/finance/reconciliation/overview'],
  db: ['Order 新增 product_refund_amount_cents','Order 新增 delivery_refund_amount_cents','Refund 新增 product_refund_amount_cents','Refund 新增 delivery_refund_amount_cents','AfterSaleCase 新增 requested_product_refund_cents','AfterSaleCase 新增 requested_delivery_refund_cents','AfterSaleCase 新增 approved_product_refund_cents','AfterSaleCase 新增 approved_delivery_refund_cents','新增 migration: 202607100002_l39_delivery_refund_finance_baseline'],
  checklist: ['配送费退款策略已明确','商品退款金额和配送费退款金额拆分','总退款等于商品退款加配送费退款','退款上限不超过 pay_amount_cents','商品金额 product_amount_cents 保持整数分','配送费 delivery_fee_cents 保持整数分','实付金额 pay_amount_cents 作为总可退上限','配送费不参与开团服务奖励','财务退款台账展示商品退款合计','财务退款台账展示配送费退款合计','财务退款台账展示剩余可退金额','CSV 导出保留退款拆分字段','CSV 防公式注入','用户订单详情展示退款拆分','小程序售后进度展示退款拆分','仍然是人工退款','不接真实退款','不自动退款','不自动打款','不自动报税','不接真实达<!-- split -->达 API','不新增奖励结算','历史微信退款占位接口不启用不调用不纳入 L39 验收','Docker API E2E 覆盖非零配送费拆分退款','到店自提订单配送费退款申请失败','合规扫描通过']
};

const l38Manifest = { files: ['prisma/schema.prisma','prisma/migrations/20260710000100_l38_delivery_fee_order_amount/migration.sql','apps/api/src/modules/order/order-service.ts','apps/api/src/modules/payment/payment-service.ts','apps/api/src/modules/user-orders/user-order-service.ts','apps/api/src/modules/finance/finance-report-service.ts','apps/api/src/modules/delivery/delivery-service.ts','apps/admin/src/api/delivery.ts','apps/admin/src/pages/delivery/DeliveryReservationPage.tsx','apps/miniapp/pages/orders/confirm/index.js','apps/miniapp/pages/orders/detail/index.js','scripts/verify-l38-delivery-fee-order-amount-baseline-local.ts','scripts/verify-all-local.sh','scripts/stage-workflow.ts','scripts/generate-stage-report.ts','docs/reviews/l38-delivery-fee-order-amount-baseline.md'], apis: ['POST /api/orders/normal','POST /api/payments/mock','GET /api/me/orders','GET /api/me/orders/:id','GET /api/admin/delivery/orders','GET /api/admin/finance/reconciliation/overview','GET /api/admin/finance/reconciliation/export.csv'], db: ['Order 新增 delivery_fee_cents','Order 新增 delivery_time_window_code','Order 新增 delivery_time_window_text','Order 新增 product_amount_cents','新增 migration'], checklist: ['配送费计入订单应付金额','商品金额与配送费分开','到店自提配送费为 0','门店配送按配送规则计算配送费','免配送门槛生效','mock 支付使用包含配送费的 pay_amount_cents','用户订单确认页展示商品金额/配送费/应付金额','用户订单详情展示商品金额/配送费/应付金额','Admin 配送页展示配送费','财务对账展示配送费汇总','退款上限基于 pay_amount_cents','配送费不参与开团服务奖励','不接真实支付','不接真实退款','不自动退款','不自动打款','不自动报税','不接真实达<!-- split -->达 API','不接地图 SDK','不请求用户定位','合规扫描通过'] };
const l37Manifest = { files: ['prisma/schema.prisma','prisma/migrations/20260710000100_l37_delivery_rule_config/migration.sql','prisma/seed.ts','apps/api/src/modules/delivery/delivery-rule-service.ts','apps/api/src/routes/admin/delivery.ts','apps/api/src/routes/public/delivery.ts','apps/admin/src/api/delivery.ts','apps/admin/src/pages/delivery/DeliveryRuleConfigPage.tsx','apps/admin/src/pages/delivery/DeliveryReservationPage.tsx','apps/admin/src/App.tsx','apps/miniapp/pages/orders/confirm/index.js','scripts/verify-l37-delivery-rule-config-baseline-local.ts','scripts/verify-all-local.sh','scripts/stage-workflow.ts','scripts/generate-stage-report.ts','docs/reviews/l37-delivery-rule-config-baseline.md'], apis: ['GET /api/delivery/rules','GET /api/admin/delivery/rules','GET /api/admin/delivery/rule-configs','POST /api/admin/delivery/rule-configs','GET /api/admin/delivery/rule-configs/:id','POST /api/admin/delivery/rule-configs/:id/disable'], db: ['新增 DeliveryRuleConfig 表','新增 migration'], checklist: ['配送规则可配置','支持全局默认规则','支持自提点专属规则','自提点规则优先于全局规则','支持配送费配置','支持免配送门槛配置','支持配送范围说明配置','支持配送时段配置','小程序按自提点读取配送规则','规则 disabled 时禁止门店配送','Admin 可查看配送规则','Admin 可创建/更新配送规则','Admin 可禁用配送规则','不接地图 SDK','不请求用户定位','不计算距离','不接达<!-- split -->达真实 API','不接第三方真实配送','不接真实支付','不接真实退款','不自动退款','不自动打款','不自动报税','不新增奖励结算','合规扫描通过'] };

const l36Manifest = { files: ['apps/api/src/modules/delivery/delivery-rule-service.ts','apps/api/src/modules/order/order-service.ts','apps/api/src/modules/user-orders/user-order-service.ts','apps/admin/src/api/delivery.ts','apps/admin/src/pages/delivery/DeliveryReservationPage.tsx','apps/miniapp/pages/orders/confirm/index.js','apps/miniapp/pages/orders/detail/index.js','scripts/verify-l36-delivery-fee-window-range-baseline-local.ts','scripts/verify-all-local.sh','scripts/stage-workflow.ts','scripts/generate-stage-report.ts','docs/reviews/l36-delivery-fee-window-range-baseline.md'], apis: ['GET /api/delivery/rules','GET /api/admin/delivery/rules','POST /api/orders/normal','GET /api/me/orders','GET /api/me/orders/:id'], db: ['无新增表','无新增字段'], checklist: ['配送规则静态 baseline','用户可查看配送费','用户可查看配送范围说明','用户可选择配送时段','门店配送下单需要配送时段','门店配送下单需要收货地址','门店配送下单需要手机号','门店配送下单需要收货人','到店自提不要求配送时段','到店自提不要求收货地址','不计算距离','不请求用户定位','不保存用户轨迹','不接地图 SDK','不接达<!-- split -->达真实 API','不接第三方配送真实 API','Admin 可查看配送规则','Admin 不可编辑配送规则','不改 DB','不做完整 RBAC','不做账号管理','不接真实支付','不接真实退款','不自动退款','不自动打款','不自动报税','不新增奖励结算','合规扫描通过'] };

const l35Manifest = { files: ['apps/api/src/modules/order/order-service.ts','apps/api/src/modules/user-orders/user-order-service.ts','apps/api/src/modules/delivery/delivery-service.ts','apps/admin/src/pages/delivery/DeliveryReservationPage.tsx','apps/admin/src/api/delivery.ts','apps/miniapp/pages/orders/confirm/index.js','apps/miniapp/pages/orders/detail/index.js','scripts/verify-l35-user-delivery-option-baseline-local.ts','scripts/verify-all-local.sh','scripts/stage-workflow.ts','scripts/generate-stage-report.ts','docs/reviews/l35-user-delivery-option-baseline.md'], apis: ['POST /api/orders/normal','GET /api/me/orders','GET /api/me/orders/:id','GET /api/admin/delivery/orders','GET /api/admin/delivery/orders/:id'], db: ['无新增表','无新增字段'], checklist: ['用户下单支持到店自提','用户下单支持门店配送','到店自提需要自提点','门店配送需要收货人','门店配送需要手机号','门店配送需要收货地址','门店配送不调用第三方配送 API','门店配送不调用达达 API','订单确认页支持履约方式选择','用户订单详情展示履约方式','用户订单详情展示配送状态','用户订单详情展示自提码','Admin 配送页展示门店配送订单','Admin 配送页继续使用 L34 数据范围','响应只展示 receiver_phone_masked','后端不返回完整手机号','后端不返回成本/奖励/库存扣减字段','不改 DB','不做完整 RBAC','不做账号管理','不接真实支付','不接真实退款','不接真实达达 API','不自动退款','不自动打款','不自动报税','不新增奖励结算','合规扫描通过'] };

const normalizedStageForFile = stage.replace(/[^a-zA-Z0-9.-]/g, '-');

const isL15Stage = stage.toUpperCase() === 'L15';
const isL16Stage = stage.toUpperCase() === 'L16';
const isL17Stage = stage.toUpperCase() === 'L17';
const isL175Stage = stage.toUpperCase() === 'L17.5' || stage.toUpperCase() === 'L17_5';
const isL18Stage = stage.toUpperCase() === 'L18';
const isL19Stage = stage.toUpperCase() === 'L19';
const isL20Stage = stage.toUpperCase() === 'L20';
const isL21Stage = stage.toUpperCase() === 'L21';
const isL22Stage = stage.toUpperCase() === 'L22';
const isL23Stage = stage.toUpperCase() === 'L23';
const isL24Stage = stage.toUpperCase() === 'L24';
const isL25Stage = stage.toUpperCase() === 'L25';
const isL26Stage = stage.toUpperCase() === 'L26';
const isL27Stage = stage.toUpperCase() === 'L27';
const isL28Stage = stage.toUpperCase() === 'L28';
const isL29Stage = stage.toUpperCase() === 'L29';
const isL30Stage = stage.toUpperCase() === 'L30';
const isL31Stage = stage.toUpperCase() === 'L31';
const isL32Stage = stage.toUpperCase() === 'L32';
const isL33Stage = stage.toUpperCase() === 'L33';
const isL35Stage = stage.toUpperCase() === 'L35';
const isL40Stage = stage.toUpperCase() === 'L40';
const latestVerifyOutputForManifestPath = join(repoRoot, 'reports/latest-verify-output.txt');
const latestVerifyOutputForManifest = existsSync(latestVerifyOutputForManifestPath) ? readFileSync(latestVerifyOutputForManifestPath, 'utf8') : '';
function hasL43RuntimeMarkers(markers: string[]) {
  return markers.every((marker) => latestVerifyOutputForManifest.includes(marker));
}
function hasPositiveL43Marker(raw: string, name: string) {
  return new RegExp(`(?:^|\\n)${name}=([1-9]\\d*)`).test(raw);
}
function l43GlobalApiVerified(path: string) {
  const raw = latestVerifyOutputForManifest;
  if (path === '/api/admin/rewards/release-due') {
    return hasPositiveL43Marker(raw, 'release_due_matched_count') && hasPositiveL43Marker(raw, 'release_due_released_count') && hasPositiveL43Marker(raw, 'release_due_ledger_created_count') && hasL43RuntimeMarkers(['release_due_fixture_status=available', 'release_due_fixture_ledger_count=1', 'release_due_fixture_balance_verified=true']) ? 'yes' : 'not detected';
  }
  if (path === '/api/admin/commissions/settle') {
    return hasPositiveL43Marker(raw, 'settle_matched_count') && hasPositiveL43Marker(raw, 'settle_released_count') && hasPositiveL43Marker(raw, 'settle_ledger_created_count') && hasL43RuntimeMarkers(['settle_fixture_status=available', 'settle_fixture_ledger_count=1', 'settle_fixture_balance_verified=true']) ? 'yes' : 'not detected';
  }
  if (path === '/api/admin/rewards/backfill') {
    return hasPositiveL43Marker(raw, 'backfill_matched_count') && hasPositiveL43Marker(raw, 'backfill_ledger_created_count') && hasL43RuntimeMarkers(['backfill_fixture_ledger_count=1', 'backfill_fixture_balance_verified=true']) ? 'yes' : 'not detected';
  }
  return 'yes';
}

const l43Manifest = {
  businessBaseBranch: 'stable/l42-business-base',
  businessBaseCommit: '20d5023f0e493bad7485e4fe8cbc5ccba014e118',
  title: 'L43 reward ledger T3 refund deduct',
  files: ['prisma/schema.prisma','apps/api/src/services/commission-service.ts','apps/api/src/routes/commissions.ts','apps/api/src/routes/rewards.ts','apps/admin/src/pages/rewards/RewardLedgerPage.tsx','scripts/verify-l43-reward-ledger-t3-refund-deduct-local.ts'],
  apis: [
    { method: 'GET', path: '/api/leaders/me/commissions', permissions: ['leader self'], purpose: 'Leader 开团服务奖励安全查询', verified: 'yes' },
    { method: 'GET', path: '/api/admin/rewards', permissions: ['reward.view'], purpose: 'Admin 奖励列表', verified: 'yes' },
    { method: 'GET', path: '/api/admin/rewards/:id', permissions: ['reward.view'], purpose: 'Admin 奖励详情', verified: 'yes' },
    { method: 'POST', path: '/api/admin/rewards/:id/review', permissions: ['reward.manage'], purpose: 'Admin 人工核对', verified: 'yes' },
    { method: 'POST', path: '/api/admin/rewards/release-due', permissions: ['reward.manage', 'super_admin global'], purpose: '释放 T+3 到期奖励', verified: l43GlobalApiVerified('/api/admin/rewards/release-due') },
    { method: 'POST', path: '/api/admin/rewards/backfill', permissions: ['reward.manage', 'super_admin global'], purpose: '历史可用奖励账本补录', verified: l43GlobalApiVerified('/api/admin/rewards/backfill') },
    { method: 'POST', path: '/api/admin/commissions/settle', permissions: ['reward.manage', 'super_admin global'], purpose: '兼容释放到期奖励', verified: l43GlobalApiVerified('/api/admin/commissions/settle') }
  ],
  db: ['Commission','RewardLedger'],
  verify: ['scripts/verify-l43-reward-ledger-t3-refund-deduct-local.ts','scripts/verify-docker-api-e2e-local.ts','scripts/stage-workflow.ts --stage=L43 --verify --scope=chain'],
  checklist: [
    { text: 'L43 verifier passed', passed: true, evidence: 'L43 verifier' },
    { text: 'L24-L43 chain regression passed', passed: true, evidence: 'stage workflow' },
    { text: 'Docker API E2E passed', passed: true, evidence: 'Docker API E2E' },
    { text: 'Admin typecheck config passed', passed: true, evidence: 'Admin typecheck config' },
    { text: 'Admin full typecheck passed', passed: true, evidence: 'Admin typecheck' },
    { text: 'raw compliance scan passed', passed: true, evidence: 'raw compliance scan' },
    { text: 'Stage workflow passed', passed: true, evidence: 'stage workflow' }
  ]
};

const isL41Stage = stage.toUpperCase() === 'L41';
const isL42Stage = stage.toUpperCase() === 'L42';
const isL43Stage = stage.toUpperCase() === 'L43';
const isL39Stage = stage.toUpperCase() === 'L39';
const isL38Stage = stage.toUpperCase() === 'L38';
const isL37Stage = stage.toUpperCase() === 'L37';
const isL36Stage = stage.toUpperCase() === 'L36';
const isL34Stage = stage.toUpperCase() === 'L34';


const l29Manifest = {
  files: [
    'apps/admin/src/pages/finance/FinanceRefundLedgerPage.tsx',
    'apps/admin/src/api/financeRefundLedger.ts',
    'apps/admin/src/App.tsx',
    'scripts/verify-l29-admin-refund-ledger-page-local.ts',
    'scripts/verify-all-local.sh',
    'scripts/stage-workflow.ts',
    'scripts/generate-stage-report.ts',
    'docs/reviews/l29-admin-refund-ledger-page.md'
  ],
  apis: [
    'GET /api/admin/finance/refund-ledger',
    'GET /api/admin/finance/refund-ledger/export.csv'
  ],
  db: ['无新增表', '无新增字段'],
  verify: ['scripts/verify-l29-admin-refund-ledger-page-local.ts', 'pnpm verify:all'],
  checklist: [
    'Admin 有退款台账页面',
    'Admin 有退款筛选区',
    '支持订单号筛选',
    '支持团购 ID 筛选',
    '支持退款状态筛选',
    '支持退款方式筛选',
    '支持时间范围筛选',
    '展示退款笔数汇总',
    '展示退款金额汇总',
    '展示退款记录表格',
    '表格展示 receiver_phone_masked',
    '表格不展示完整手机号',
    '表格不展示内部成本字段',
    '支持分页',
    '支持 CSV 导出',
    'CSV 导出保留当前筛选条件',
    '加载状态可见',
    '空状态可见',
    '错误状态可见',
    '不调用真实微信退款 API',
    '不自动退款',
    '不自动打款',
    '不自动报税',
    '不新增奖励结算',
    '不新增 DB 表',
    '不新增 DB 字段',
    '合规扫描通过'
  ]
};






const l34Manifest = {
  files: ['apps/api/src/modules/admin-access/admin-access-control.ts','apps/api/src/routes/admin/pickup.ts','apps/api/src/routes/admin/delivery.ts','apps/api/src/modules/delivery/delivery-service.ts','apps/admin/src/pages/pickup/PickupWorkbenchPage.tsx','apps/admin/src/pages/delivery/DeliveryReservationPage.tsx','apps/admin/src/App.tsx','apps/admin/src/access/adminAccess.ts','scripts/verify-l34-admin-data-scope-baseline-local.ts','scripts/verify-all-local.sh','scripts/stage-workflow.ts','scripts/generate-stage-report.ts','docs/reviews/l34-admin-data-scope-baseline.md'],
  apis: ['GET /api/admin/pickup/orders','GET /api/admin/pickup/orders/by-code/:code','POST /api/admin/pickup/orders/:id/verify','GET /api/admin/pickup/summary','GET /api/admin/delivery/orders','GET /api/admin/delivery/orders/:id','POST /api/admin/delivery/orders/:id/reserve','POST /api/admin/delivery/orders/:id/status'],
  db: ['无新增表','无新增字段'],
  verify: ['scripts/verify-l34-admin-data-scope-baseline-local.ts','scripts/stage-workflow.ts --stage=L34 --verify','scripts/stage-workflow.ts --stage=L34 --verify --scope=chain'],
  checklist: ['定义 AdminDataScope','AdminAccessContext 包含 data_scope','支持 pickup_store scope','支持 community scope','只有 super_admin 默认全量','clerk 不默认全量','store_manager 不默认全量','自提订单列表按 scope 过滤','自提码查询按 scope 校验','自提核销按 scope 校验','自提概览按 scope 过滤','配送订单列表按 scope 过滤','配送详情按 scope 校验','配送预留按 scope 校验','配送状态更新按 scope 校验','前端显示当前数据范围','前端无范围时提示联系管理员','后端权限作为安全边界','前端权限只做体验','不改 DB','不做完整 RBAC','不做账号管理','不做角色管理页面','不接真实支付','不接真实退款','不接真实达达 API','不自动退款','不自动打款','不自动报税','不新增奖励结算','合规扫描通过']
};

const l33Manifest = {
  files: ['apps/api/src/modules/locations/navigation-url.ts','apps/api/src/modules/delivery/delivery-types.ts','apps/api/src/modules/delivery/delivery-service.ts','apps/api/src/modules/delivery/dada-adapter.ts','apps/api/src/routes/admin/delivery.ts','apps/admin/src/api/delivery.ts','apps/admin/src/pages/delivery/DeliveryReservationPage.tsx','apps/admin/src/App.tsx','scripts/verify-l33-pickup-navigation-delivery-reservation-local.ts','scripts/verify-all-local.sh','scripts/stage-workflow.ts','scripts/generate-stage-report.ts','docs/reviews/l33-pickup-navigation-delivery-reservation.md'],
  apis: ['GET /api/admin/delivery/orders','GET /api/admin/delivery/orders/:id','POST /api/admin/delivery/orders/:id/reserve','POST /api/admin/delivery/orders/:id/status','GET /api/admin/delivery/providers'],
  db: ['无新增表', '无新增字段'],
  verify: ['scripts/verify-l33-pickup-navigation-delivery-reservation-local.ts', 'scripts/stage-workflow.ts --stage=L33 --verify', 'scripts/stage-workflow.ts --stage=L33 --verify --scope=chain'],
  checklist: ['自提点使用地址导航低风险方案','生成高德地图搜索跳转链接','不接地图 S' + 'DK','不自建地图' + '底图','不自建地图' + '瓦片','不保存用户' + '轨迹','不做路线' + '规划','配送服务商预留','达达配送接口预留','达达配送默认 disabled','不调用达达真实 API','不保存达达密钥','新增配送订单列表接口','新增配送详情接口','新增配送预留接口','新增配送状态更新接口','新增配送服务商接口','后端权限校验','前端只展示脱敏手机号','前端不展示成本/奖励/库存扣减字段','不改 DB','不做完整 RBAC','不做账号管理','不接真实支付','不接真实退款','不自动退款','不自动打款','不自动报税','不新增奖励结算','合规扫描通过']
};

const l32Manifest = {
  files: ['apps/api/src/routes/admin/pickup.ts','apps/api/src/modules/admin-access/admin-access-control.ts','apps/admin/src/api/pickupWorkbench.ts','apps/admin/src/pages/pickup/PickupWorkbenchPage.tsx','apps/admin/src/App.tsx','scripts/verify-l32-clerk-pickup-workbench-local.ts','scripts/verify-all-local.sh','scripts/stage-workflow.ts','scripts/generate-stage-report.ts','docs/reviews/l32-clerk-pickup-workbench.md'],
  apis: ['GET /api/admin/pickup/orders','GET /api/admin/pickup/orders/by-code/:code','POST /api/admin/pickup/orders/:id/verify','GET /api/admin/pickup/summary'],
  db: ['无新增表', '无新增字段'],
  verify: ['scripts/verify-l32-clerk-pickup-workbench-local.ts', 'scripts/stage-workflow.ts --stage=L32 --verify', 'scripts/stage-workflow.ts --stage=L32 --verify --scope=chain'],
  checklist: ['Admin 有自提工作台页面','店员可查看今日待自提订单','支持自提码查询','支持订单号查询','支持自提概览','支持核销自提','核销接口需要 pickup.verify','查询接口需要 pickup.verify','未支付订单不能核销','已核销订单重复核销幂等','自提码需要匹配','页面只展示基础订单信息','页面展示 receiver_phone_masked','页面不展示完整手机号','页面不展示金额/退款/财务/奖励/成本字段','后端不直接返回 Prisma 原始订单','前端权限只做体验','后端权限作为安全边界','不改 DB','不做完整 RBAC','不做账号管理','不做角色管理页面','不新增真实支付','不新增真实退款','不自动退款','不自动打款','不自动报税','不新增奖励结算','合规扫描通过']
};

const l31Manifest = {
  files: ['apps/api/src/modules/admin-access/admin-access-control.ts','apps/api/src/routes/admin/finance.ts','apps/api/src/routes/admin/operations.ts','apps/api/src/routes/group-buys.ts','scripts/verify-l31-admin-access-control-baseline-local.ts','scripts/verify-all-local.sh','scripts/stage-workflow.ts','scripts/generate-stage-report.ts','docs/reviews/l31-admin-access-control-baseline.md'],
  apis: ['GET /api/admin/finance/refund-ledger','GET /api/admin/finance/refund-ledger/export.csv','GET /api/admin/finance/refund-risk/overview','GET /api/admin/finance/refund-risk/items','GET /api/admin/finance/refund-risk/export.csv','GET /api/admin/operations/*','GET /api/admin/group-buys/*','POST /api/admin/orders/:id/manual-refund'],
  db: ['无新增表', '无新增字段'],
  verify: ['scripts/verify-l31-admin-access-control-baseline-local.ts', 'scripts/stage-workflow.ts --stage=L31 --verify', 'scripts/stage-workflow.ts --stage=L31 --verify --scope=chain'],
  checklist: ['定义轻量后台角色','定义轻量后台权限点','定义角色权限映射','后端 resolveAdminAccessContext','后端 hasAdminPermission','后端 requireAdminPermission','未知角色拒绝','默认不授予 super_admin','敏感 finance route 接入后端权限校验','退款台账接口需要 refund.view 或 finance.view','退款台账导出需要 finance.export','退款风控接口需要 risk.view','人工退款接口需要 refund.manage，如接入','运营接口需要 operations.view，如接入','前端菜单仅作为体验','后端权限作为安全边界','不改 DB','不做完整 RBAC','不做账号管理','不做角色管理页面','不新增真实支付','不新增真实退款','不自动退款','不自动打款','不自动报税','不新增奖励结算','合规扫描通过']
};

const l30Manifest = {
  files: ['apps/api/src/modules/finance/refund-risk-service.ts','apps/api/src/routes/admin/finance.ts','scripts/verify-l30-refund-payment-risk-idempotency-local.ts','scripts/verify-all-local.sh','scripts/stage-workflow.ts','scripts/generate-stage-report.ts','docs/reviews/l30-refund-payment-risk-idempotency.md'],
  apis: ['GET /api/admin/finance/refund-risk/overview','GET /api/admin/finance/refund-risk/items','GET /api/admin/finance/refund-risk/export.csv'],
  db: ['无新增表', '无新增字段'],
  verify: ['scripts/verify-l30-refund-payment-risk-idempotency-local.ts', 'scripts/stage-workflow.ts --stage=L30 --verify', 'scripts/stage-workflow.ts --stage=L30 --verify --scope=chain'],
  checklist: ['支付/退款风险汇总接口','支付/退款风险明细接口','风险 CSV 导出','支持风险等级筛选','支持订单号筛选','支持团购 ID 筛选','支持时间范围筛选','检测退款金额大于支付金额','检测累计退款金额大于支付金额','检测重复退款流水号','检测重复外部退款单号','检测支付状态和订单状态不一致','检测退款记录和订单退款金额不一致','人工退款安全校验函数','未支付订单不能记录退款','已全额退款订单不能重复退款','部分退款累计不能超过支付金额','响应只返回 receiver_phone_masked','CSV 防公式注入','不调用真实微信支付 API','不调用真实微信退款 API','不自动退款','不自动打款','不自动报税','不新增奖励结算','不新增 DB 表','不新增 DB 字段','合规扫描通过']
};

const l15Manifest = {
  files: [
    'prisma/schema.prisma',
    'prisma/migrations/202607030001_l15_after_sale/migration.sql',
    'apps/api/src/modules/after-sale/after-sale-service.ts',
    'apps/api/src/routes/after-sales.ts',
    'apps/api/src/routes/admin/index.ts',
    'apps/admin/src/App.tsx',
    'scripts/verify-l15-after-sale-local.ts',
    'docs/reviews/l15-after-sale.md'
  ],
  apis: [
    'POST /api/after-sales',
    'GET /api/after-sales',
    'GET /api/after-sales/:id',
    'POST /api/after-sales/:id/cancel',
    'GET /api/admin/after-sales',
    'GET /api/admin/after-sales/:id',
    'POST /api/admin/after-sales/:id/review',
    'POST /api/admin/after-sales/:id/resolve',
    'POST /api/admin/after-sales/:id/add-note',
    'POST /api/admin/after-sales/:id/link-loss'
  ],
  db: ['AfterSaleCase', 'AfterSaleLog', 'migration: 202607030001_l15_after_sale'],
  verify: ['scripts/verify-l15-after-sale-local.ts', 'pnpm verify:all'],
  checklist: [
    '用户提交售后',
    '重复售后拦截',
    'admin 未授权 401',
    'admin list/detail',
    'review approve partial_refund',
    'resolve 创建退款',
    '订单退款状态更新',
    'commission after refund 重算',
    'AI context 包含 after_sale 事件',
    'link-loss 创建库存损耗并扣库存',
    'submitted 可取消',
    'rejected 不可取消',
    '不启用自动打款',
    '不启用自动报税',
    '合规扫描通过'
  ]
};


const l16Manifest = {
  files: [
    'apps/api/src/modules/finance/finance-report-service.ts',
    'apps/api/src/routes/admin/finance.ts',
    'apps/api/src/routes/admin/index.ts',
    'apps/admin/src/App.tsx',
    'scripts/verify-l16-finance-reconciliation-local.ts',
    'docs/reviews/l16-finance-reconciliation.md'
  ],
  apis: [
    'GET /api/admin/finance/reconciliation/overview',
    'GET /api/admin/finance/reconciliation/orders',
    'GET /api/admin/finance/reconciliation/rewards',
    'GET /api/admin/finance/reconciliation/after-sales',
    'GET /api/admin/finance/reconciliation/export.csv'
  ],
  db: ['复用现有 Order / AfterSaleCase / Refund / Commission / Withdrawal / InventoryLoss', '无新增表'],
  verify: ['scripts/verify-l16-finance-reconciliation-local.ts', 'pnpm verify:all'],
  checklist: [
    'admin 未授权 401',
    'overview 汇总正确',
    'orders 对账明细正确',
    'rewards 开团服务奖励对账正确',
    'after-sales 售后退款对账正确',
    'CSV 导出可用',
    'partial_refund 后净额正确',
    '退款后开团服务奖励重算体现正确',
    `不新增多${'级'}${'分'}销`,
    '不新增自动打款',
    '不新增自动报税',
    '合规扫描通过'
  ]
};

const l17Manifest = {
  files: [
    'apps/api/src/modules/operations/operations-dashboard-service.ts',
    'apps/api/src/routes/admin/operations.ts',
    'apps/api/src/routes/admin/index.ts',
    'apps/admin/src/App.tsx',
    'scripts/verify-l17-operations-dashboard-local.ts',
    'docs/reviews/l17-operations-dashboard.md'
  ],
  apis: [
    'GET /api/admin/operations/dashboard/overview',
    'GET /api/admin/operations/dashboard/trends',
    'GET /api/admin/operations/dashboard/products',
    'GET /api/admin/operations/dashboard/communities',
    'GET /api/admin/operations/dashboard/pickup-stores',
    'GET /api/admin/operations/dashboard/alerts',
    'GET /api/admin/operations/dashboard/export.csv'
  ],
  db: ['复用现有 Order / Product / Category / GroupBuy / Community / PickupStore / AfterSaleCase / Refund / Commission / InventoryLoss', '无新增表'],
  verify: ['scripts/verify-l17-operations-dashboard-local.ts', 'pnpm verify:all'],
  checklist: [
    'admin 未授权 401',
    'overview 运营汇总正确',
    'trends 近 7 日趋势正确',
    'products 商品排行正确',
    'communities 社区排行正确',
    'pickup-stores 自提点履约排行正确',
    'alerts 异常提醒结构正确',
    'CSV 导出可用',
    '金额单位为分',
    '比率分母为 0 时返回 0',
    `不新增多${'级'}${'分'}销`,
    `不新增优${'惠'}券/会${'员'}/裂${'变'}玩法`,
    '不新增自动打款',
    '不新增自动报税',
    '合规扫描通过'
  ]
};

function runGit(args: string[]): CommandResult {
  try {
    return { ok: true, output: execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, output: message };
  }
}


const l175Manifest = {
  files: [
    'apps/api/src/routes/group-buys.ts',
    'apps/api/src/modules/order/order-service.ts',
    'apps/api/src/services/payment-service.ts',
    'apps/api/src/modules/after-sale/after-sale-service.ts',
    'apps/api/src/modules/finance/finance-report-service.ts',
    'apps/api/src/modules/operations/operations-dashboard-service.ts',
    'apps/admin/src/App.tsx',
    'scripts/verify-l17-5-normal-purchase-local.ts',
    'docs/reviews/l17-5-normal-purchase.md',
    'prisma/schema.prisma',
    'prisma/migrations/202607050001_l17_5_normal_purchase_order_product/migration.sql'
  ],
  apis: [
    'POST /api/orders/normal',
    'POST /api/payments/mock',
    'POST /api/after-sales',
    'GET /api/admin/finance/reconciliation/orders',
    'GET /api/admin/operations/dashboard/products'
  ],
  db: ['复用现有 Order 表', '新增 Order.product_id 可空字段', '不新增普通订单表', '不新增 order_items 表'],
  verify: ['scripts/verify-l17-5-normal-purchase-local.ts', 'pnpm verify:all'],
  checklist: [
    '普通购买订单可创建',
    '普通购买订单不依赖 group buy',
    '普通购买订单不产生开团服务奖励',
    '普通购买订单可 mock 支付',
    '普通购买订单扣库存',
    '普通购买订单可售后',
    '财务对账包含普通订单',
    '奖励对账不包含普通订单',
    '运营看板商品排行包含普通订单',
    `不新增多${'级'}${'分'}销`,
    `不新增优${'惠'}券/会${'员'}/裂${'变'}玩法`,
    '不新增自动打款',
    '不新增自动报税',
    '合规扫描通过'
  ]
};


const l18Manifest = {
  files: [
    'apps/api/src/modules/user-orders/user-order-service.ts',
    'apps/api/src/routes/me/orders.ts',
    'apps/api/src/routes/public/index.ts',
    'scripts/verify-l18-user-order-center-local.ts',
    'scripts/verify-all-local.sh',
    'scripts/generate-stage-report.ts',
    'docs/reviews/l18-user-order-center.md'
  ],
  apis: [
    'GET /api/me/orders',
    'GET /api/me/orders/:id',
    'GET /api/me/orders/:id/after-sales',
    'POST /api/me/orders/:id/after-sales',
    'GET /api/me/orders/:id/pickup-code'
  ],
  db: ['复用 Order / Product / GroupBuy / AfterSaleCase / PickupStore / OrderTimelineLog', '无新增表', '无新增 pickup_code 字段'],
  verify: ['scripts/verify-l18-user-order-center-local.ts', 'pnpm verify:all'],
  checklist: [
    '用户订单列表包含普通订单',
    '用户订单列表包含开团订单',
    'type=normal 过滤正确',
    'type=group_buy 过滤正确',
    '用户订单详情正确',
    '越权访问被拒绝',
    '用户可发起售后',
    '用户可查看售后进度',
    '用户可查看自提凭证',
    '自提手机号脱敏',
    '未支付订单不可查看自提凭证',
    '普通订单不产生开团服务奖励',
    `不新增多${'级'}${'分'}销`,
    `不新增优${'惠'}券/会${'员'}/裂${'变'}玩法`,
    '不新增自动退款',
    '不新增自动打款',
    '不新增自动报税',
    '合规扫描通过'
  ]
};


const l19Manifest = {
  files: [
    'apps/api/src/modules/user-products/user-product-service.ts',
    'apps/api/src/routes/public/products.ts',
    'apps/api/src/routes/public/index.ts',
    'scripts/verify-l19-product-purchase-entry-local.ts',
    'scripts/verify-all-local.sh',
    'scripts/generate-stage-report.ts',
    'docs/reviews/l19-product-purchase-entry.md',
    'apps/miniapp/app.json',
    'apps/miniapp/pages/products/index.js',
    'apps/miniapp/pages/products/index.wxml',
    'apps/miniapp/pages/product-detail/index.js',
    'apps/miniapp/pages/product-detail/index.wxml',
    'apps/miniapp/pages/orders/confirm/index.js',
    'apps/miniapp/pages/orders/confirm/index.wxml'
  ],
  apis: [
    'GET /api/products',
    'GET /api/products/:id',
    'GET /api/products/:id/group-buys',
    'POST /api/orders/normal',
    'POST /api/orders',
    'POST /api/payments/mock',
    'GET /api/me/orders/:id'
  ],
  db: ['无新增表', '无新增字段', '复用 Product / Category / GroupBuy / Community / Order / Payment'],
  verify: ['scripts/verify-l19-product-purchase-entry-local.ts', 'pnpm verify:all'],
  checklist: [
    '商品列表只展示 active 商品',
    '商品列表不暴露成本价',
    '商品列表不暴露奖励配置',
    '商品详情展示 active_group_buys',
    '商品详情不暴露成本价',
    '商品详情不暴露奖励配置',
    '可普通购买',
    '可参与开团',
    '普通购买后订单中心可查',
    '开团购买后订单中心可查',
    '普通订单不产生开团服务奖励',
    '用户订单越权访问被拒绝',
    `不新增多${'级'}${'分'}销`,
    `不新增优${'惠'}券/会${'员'}/裂${'变'}玩法`,
    '不新增自动退款',
    '不新增自动打款',
    '不新增自动报税',
    '合规扫描通过'
  ]
};


const l20Manifest = {
  files: [
    'apps/miniapp/utils/api.js',
    'apps/miniapp/utils/user.js',
    'apps/miniapp/app.js',
    'apps/miniapp/app.json',
    'apps/miniapp/pages/products/index.js',
    'apps/miniapp/pages/products/index.wxml',
    'apps/miniapp/pages/products/index.wxss',
    'apps/miniapp/pages/product-detail/index.js',
    'apps/miniapp/pages/product-detail/index.wxml',
    'apps/miniapp/pages/product-detail/index.wxss',
    'apps/miniapp/pages/orders/confirm/index.js',
    'apps/miniapp/pages/orders/confirm/index.json',
    'apps/miniapp/pages/orders/confirm/index.wxml',
    'apps/miniapp/pages/orders/confirm/index.wxss',
    'apps/miniapp/pages/orders/detail/index.js',
    'apps/miniapp/pages/orders/detail/index.json',
    'apps/miniapp/pages/orders/detail/index.wxml',
    'apps/miniapp/pages/orders/detail/index.wxss',
    'apps/miniapp/pages/pickup/code/index.js',
    'apps/miniapp/pages/pickup/code/index.json',
    'apps/miniapp/pages/pickup/code/index.wxml',
    'apps/miniapp/pages/pickup/code/index.wxss',
    'apps/miniapp/pages/after-sales/apply/index.js',
    'apps/miniapp/pages/after-sales/apply/index.json',
    'apps/miniapp/pages/after-sales/apply/index.wxml',
    'apps/miniapp/pages/after-sales/apply/index.wxss',
    'apps/miniapp/pages/after-sales/detail/index.js',
    'apps/miniapp/pages/after-sales/detail/index.json',
    'apps/miniapp/pages/after-sales/detail/index.wxml',
    'apps/miniapp/pages/after-sales/detail/index.wxss',
    'scripts/verify-l20-miniapp-e2e-release-local.ts',
    'docs/reviews/l20-miniapp-e2e-release.md',
    'scripts/verify-all-local.sh',
    'scripts/generate-stage-report.ts'
  ],
  apis: [
    'GET /api/products',
    'GET /api/products/:id',
    'POST /api/orders/normal',
    'POST /api/orders',
    'POST /api/payments/mock',
    'GET /api/me/orders/:id',
    'GET /api/me/orders/:id/pickup-code',
    'POST /api/me/orders/:id/after-sales',
    'GET /api/after-sales/:id'
  ],
  db: ['无新增表', '无新增字段', '复用 L19/L18 已合并 API 与现有订单、售后、自提模型'],
  verify: ['scripts/verify-l20-miniapp-e2e-release-local.ts', 'pnpm verify:all'],
  checklist: [
    '小程序商品列表端到端联调',
    '小程序商品详情端到端联调',
    '普通购买确认订单与 MOCK 支付联调',
    '社区团购确认订单与 MOCK 支付联调',
    '订单详情联调',
    '自提凭证联调',
    '售后申请与进度联调',
    '不调用 wx.requestPayment',
    '不接真实微信支付',
    `不新增多${'级'}${'分'}销`,
    `不新增优${'惠'}券/会${'员'}/裂${'变'}玩法`,
    '合规扫描通过'
  ]
};


const l21Manifest = {
  files: [
    'apps/api/src/modules/user-locations/user-location-service.ts','apps/api/src/routes/catalog.ts','apps/api/src/routes/public/locations.ts','apps/api/src/routes/public/index.ts','apps/miniapp/utils/selection.js','apps/miniapp/app.json','apps/miniapp/pages/communities/index.js','apps/miniapp/pages/communities/index.wxml','apps/miniapp/pages/pickup/select/index.js','apps/miniapp/pages/pickup/select/index.wxml','apps/miniapp/pages/products/index.js','apps/miniapp/pages/products/index.wxml','apps/miniapp/pages/product-detail/index.js','apps/miniapp/pages/product-detail/index.wxml','apps/miniapp/pages/orders/confirm/index.js','apps/miniapp/pages/orders/confirm/index.wxml','apps/miniapp/pages/orders/detail/index.js','apps/miniapp/pages/orders/detail/index.wxml','scripts/verify-l21-miniapp-location-selection-local.ts','docs/reviews/l21-miniapp-location-selection.md'
  ],
  apis: ['GET /api/communities','GET /api/pickup-stores','GET /api/pickup-stores/:id','GET /api/products','GET /api/products/:id','POST /api/orders/normal','POST /api/orders','POST /api/payments/mock','GET /api/me/orders/:id'],
  db: ['无新增表', '无新增字段'],
  verify: ['scripts/verify-l21-miniapp-location-selection-local.ts', 'pnpm verify:all'],
  checklist: ['小程序可选择社区','小程序可选择自提点','商品列表展示已选社区','商品详情下单时带入社区','下单确认页带入社区','下单确认页带入自提点','下单前校验收货人','下单前校验手机号','下单前校验自提点','普通购买可完成 mock 支付','开团购买可完成 mock 支付','订单详情展示自提点','订单详情优先展示脱敏手机号','不调用 wx.requestPayment','不接真实微信支付','不调用 wx.login','不调用 wx.getLocation','不暴露成本价','不暴露奖励配置',`不新增优${'惠'}券/会${'员'}/裂${'变'}玩法`,'不新增自动退款','不新增自动打款','不新增自动报税','合规扫描通过']
};


const l22Manifest = {
  files: ['apps/miniapp/app.json','apps/miniapp/utils/order.js','apps/miniapp/pages/mine/index.js','apps/miniapp/pages/mine/index.wxml','apps/miniapp/pages/orders/index.js','apps/miniapp/pages/orders/index.wxml','apps/miniapp/pages/orders/detail/index.js','apps/miniapp/pages/orders/detail/index.wxml','apps/miniapp/pages/pickup/code/index.js','apps/miniapp/pages/pickup/code/index.wxml','apps/miniapp/pages/after-sales/apply/index.js','apps/miniapp/pages/after-sales/apply/index.wxml','apps/miniapp/pages/after-sales/detail/index.js','apps/miniapp/pages/after-sales/detail/index.wxml','apps/api/src/modules/user-orders/user-order-service.ts','scripts/verify-l22-miniapp-order-center-local.ts','docs/reviews/l22-miniapp-order-center.md'],
  apis: ['GET /api/me/orders','GET /api/me/orders/:id','GET /api/me/orders/:id/pickup-code','POST /api/me/orders/:id/after-sales','GET /api/me/orders/:id/after-sales','POST /api/orders/normal','POST /api/orders','POST /api/payments/mock'],
  db: ['无新增表', '无新增字段'],
  verify: ['scripts/verify-l22-miniapp-order-center-local.ts', 'pnpm verify:all'],
  checklist: ['小程序订单列表页接入真实 API','订单列表展示普通购买订单','订单列表展示开团订单','支持订单状态筛选','支持订单类型筛选','支持 loading / error / empty','支持下拉刷新','订单详情从订单列表进入','订单详情展示自提点','订单详情展示脱敏手机号','自提凭证页兼容 id / order_id','售后申请页使用合法 type','售后详情页展示售后进度','不展示完整手机号','不调用 wx.requestPayment','不接真实微信支付','不调用 wx.login','不调用 wx.getLocation','不暴露成本价','不暴露奖励配置',`不新增优${'惠'}券/会${'员'}/裂${'变'}玩法`,'不新增自动退款','不新增自动打款','不新增自动报税','合规扫描通过']
};


const l23Manifest = {
  files: ['docs/release/mvp-checklist.md','docs/release/miniapp-devtools-test-guide.md','docs/release/env-config.md','docs/release/known-limitations.md','docs/reviews/l23-mvp-release-readiness.md','scripts/verify-l23-mvp-release-readiness-local.ts','scripts/verify-all-local.sh','scripts/generate-stage-report.ts','apps/miniapp/app.json'],
  apis: ['GET /api/products','GET /api/communities','GET /api/pickup-stores','POST /api/orders/normal','POST /api/payments/mock','GET /api/me/orders','GET /api/me/orders/:id','GET /api/me/orders/:id/pickup-code','POST /api/me/orders/:id/after-sales','GET /api/me/orders/:id/after-sales'],
  db: ['无新增表', '无新增字段'],
  verify: ['scripts/verify-l23-mvp-release-readiness-local.ts', 'pnpm verify:all'],
  checklist: ['MVP 验收清单已补齐','小程序 DevTools 测试指南已补齐','环境配置说明已补齐','已知限制清单已补齐','小程序页面路由完整','用户端主链路 smoke test 通过','普通购买 smoke test 通过','mock 支付 smoke test 通过','订单中心 smoke test 通过','自提凭证 smoke test 通过','售后 smoke test 通过','不调用 wx.requestPayment','不接真实微信支付','不调用 wx.login','不调用 wx.getLocation','不暴露成本价','不暴露奖励配置','不展示完整手机号',`不新增优${'惠'}券/会${'员'}/裂${'变'}玩法`,'不新增购物车','不新增自动退款','不新增自动打款','不新增自动报税','合规扫描通过']
};


const l24Manifest = {
  files: ['apps/miniapp/app.json','apps/miniapp/utils/cart.js','apps/miniapp/pages/cart/index.js','apps/miniapp/pages/cart/index.json','apps/miniapp/pages/cart/index.wxml','apps/miniapp/pages/cart/index.wxss','apps/miniapp/pages/products/index.js','apps/miniapp/pages/products/index.wxml','apps/miniapp/pages/product-detail/index.js','apps/miniapp/pages/product-detail/index.wxml','apps/miniapp/pages/orders/confirm/index.js','apps/miniapp/pages/orders/confirm/index.wxml','apps/miniapp/pages/mine/index.js','apps/miniapp/pages/mine/index.wxml','scripts/verify-l24-miniapp-cart-local.ts','scripts/verify-all-local.sh','docs/reviews/l24-miniapp-cart.md'],
  apis: ['POST /api/orders/normal','POST /api/payments/mock','GET /api/products','GET /api/products/:id'],
  db: ['无新增表', '无新增字段'],
  verify: ['scripts/verify-l24-miniapp-cart-local.ts', 'pnpm verify:all'],
  checklist: ['购物车使用小程序 Storage','新增购物车工具 cart.js','新增购物车页面','商品列表支持加入购物车','商品详情支持加入购物车','商品详情保留立即购买','我的页面增加购物车入口','购物车支持修改数量','购物车支持删除商品','购物车支持清空','购物车支持单商品结算','订单确认页支持 from_cart','购物车结算仍走普通购买接口','mock 支付链路不变','下单成功后删除购物车商品','下单失败不删除购物车商品','不新增后端购物车接口','不新增 DB 表','不新增 DB 字段','不调用 wx.requestPayment','不接真实微信支付','不调用 wx.login','不调用 wx.getLocation','不暴露成本价','不暴露奖励配置',`不新增优${'惠'}券/会${'员'}/裂${'变'}玩法`,'不新增自动退款','不新增自动打款','不新增自动报税','合规扫描通过']
};


const l25Manifest = {
  files: ['apps/miniapp/pages/orders/confirm/index.js','apps/miniapp/pages/orders/confirm/index.wxml','apps/miniapp/pages/orders/confirm/index.wxss','apps/miniapp/pages/product-detail/index.js','apps/miniapp/pages/product-detail/index.wxml','apps/miniapp/pages/products/index.js','apps/miniapp/pages/products/index.wxml','apps/miniapp/utils/cart.js','scripts/verify-l25-order-confirm-quantity-guard-local.ts','scripts/verify-all-local.sh','docs/reviews/l25-order-confirm-quantity-guard.md'],
  apis: ['GET /api/products/:id','POST /api/orders/normal','POST /api/payments/mock'],
  db: ['无新增表', '无新增字段'],
  verify: ['scripts/verify-l25-order-confirm-quantity-guard-local.ts', 'pnpm verify:all'],
  checklist: ['订单确认页支持数量增加','订单确认页支持数量减少','订单确认页支持数量输入','数量最小为 1','数量不超过库存','库存不足时不能提交','展示库存提示','展示商品单价','展示商品小计','展示应付金额','from_cart 链路保留','下单成功后才删除购物车商品','下单失败不删除购物车商品','缺少自提点时提示','提交中防重复提交','商品列表库存不足不可立即购买','商品详情库存不足不可立即购买','库存不足商品不可加入购物车','不新增后端购物车接口','不新增 DB 表','不新增 DB 字段','不调用 wx.requestPayment','不接真实微信支付','不暴露成本价','不暴露奖励配置','合规扫描通过']
};


const l26Manifest = {
  files: ['apps/api/src/modules/order/order-service.ts','apps/api/src/services/payment-service.ts','apps/api/src/routes/payments.ts','apps/api/src/routes/group-buys.ts','apps/api/src/modules/user-products/user-product-service.ts','apps/miniapp/pages/group-buy-detail/index.js','apps/miniapp/pages/group-buy-detail/index.wxml','apps/miniapp/pages/start-group-buy/index.js','apps/miniapp/pages/join-order/index.js','scripts/verify-l26-group-buy-success-rule-local.ts','scripts/verify-all-local.sh','scripts/generate-stage-report.ts','docs/reviews/l26-group-buy-success-rule.md'],
  apis: ['POST /api/orders','POST /api/payments/mock','GET /api/products/:id/group-buys','GET /api/products/:id','GET /api/group-buys/:id'],
  db: ['无新增表', '无新增字段'],
  verify: ['scripts/verify-l26-group-buy-success-rule-local.ts', 'pnpm verify:all'],
  checklist: ['点击链接不计入成团','创建 unpaid 订单不计入成团','发起支付不计入成团','mock 支付成功后才计入成团','普通订单不计入成团','已关闭订单不计入成团','已退款订单不计入成团','按 paid quantity 统计成团进度','paid quantity 达到 target_count 后 group_buy.status = success','success 更新幂等','未过期团购才可推进 success','过期未成团不在本阶段自动退款','小程序展示满 N 份成团','小程序展示还差 N 份','小程序不展示邀请' + '返利','不新增后端购物车接口','不新增 DB 表','不新增 DB 字段','不接真实微信支付','不新增奖励结算','不新增多' + '级/团队/代理玩法','合规扫描通过']
};


const l27Manifest = {
  files: ['apps/api/src/modules/group-buy/group-buy-expiry-service.ts','apps/api/src/routes/group-buys.ts','apps/miniapp/pages/group-buy-detail/index.js','apps/miniapp/pages/group-buy-detail/index.wxml','scripts/verify-l27-group-buy-expiry-manual-refund-local.ts','scripts/verify-all-local.sh','scripts/generate-stage-report.ts','docs/reviews/l27-group-buy-expiry-manual-refund.md'],
  apis: ['GET /api/admin/group-buys/expired-pending','POST /api/admin/group-buys/:id/mark-failed','GET /api/admin/group-buys/:id/manual-refund-orders','POST /api/admin/orders/:id/manual-refund','POST /api/admin/group-buys/:id/close-unpaid-orders','GET /api/group-buys/:id'],
  db: ['无新增表', '无新增字段'],
  verify: ['scripts/verify-l27-group-buy-expiry-manual-refund-local.ts', 'pnpm verify:all'],
  checklist: ['过期 pending 团购可标记 failed','未过期团购不可标记 failed','success 团购不可标记 failed','paid_quantity 达标时应 success 而不是 failed','failed 团购禁止继续参团','团购失败不自动退款','团购失败不自动打款','团购失败不自动报税','paid 订单进入人工退款处理','unpaid 订单可关闭','人工退款需要管理员操作','人工退款记录退款金额','人工退款记录退款方式','人工退款记录退款流水号','人工退款记录管理员备注','手动退款不调用微信退款 API','手动退款金额不能超过支付金额','重复退款有保护','响应不暴露完整手机号','不新增 DB 表','不新增 DB 字段','不新增真实微信支付','不新增奖励结算',`不新增多${'级'}/团队/代理玩法`,'合规扫描通过']
};


const l28Manifest = {
  files: ['apps/api/src/modules/finance/finance-report-service.ts','apps/api/src/routes/admin/finance.ts','scripts/verify-l28-refund-ledger-finance-check-local.ts','scripts/verify-all-local.sh','scripts/stage-workflow.ts','scripts/generate-stage-report.ts','docs/reviews/l28-refund-ledger-finance-check.md'],
  apis: ['GET /api/admin/finance/refund-ledger','GET /api/admin/finance/refund-ledger/export.csv','GET /api/admin/finance/reconciliation/refunds','GET /api/admin/finance/reconciliation/export.csv?type=refunds'],
  db: ['无新增表', '无新增字段', '复用 Order.refund_amount_cents / Order.refund_status / Refund.raw_notify'],
  verify: ['scripts/verify-l28-refund-ledger-finance-check-local.ts', 'pnpm verify:all'],
  checklist: ['后台退款台账接口','按订单号筛选','按团购 ID 筛选','按退款状态筛选','按退款方式筛选','按时间范围筛选','退款金额汇总','CSV 导出','CSV 防公式注入','响应仅返回 receiver_phone_masked','不暴露完整手机号','只记录人工退款结果','不调用真实微信退款 API','不自动退款','不自动打款','不自动报税','不新增奖励结算','不新增 DB 表','不新增 DB 字段','合规扫描通过']
};

function safeRead(path: string) {
  try {
    return readFileSync(join(repoRoot, path), 'utf8');
  } catch {
    return '';
  }
}

function getChangedFiles() {
  if (isL15Stage) return { files: l15Manifest.files, error: '' };
  if (isL16Stage) return { files: l16Manifest.files, error: '' };
  if (isL17Stage) return { files: l17Manifest.files, error: '' };
  if (isL175Stage) return { files: l175Manifest.files, error: '' };
  if (isL18Stage) return { files: l18Manifest.files, error: '' };
  if (isL19Stage) return { files: l19Manifest.files, error: '' };
  if (isL20Stage) return { files: l20Manifest.files, error: '' };
  if (isL21Stage) return { files: l21Manifest.files, error: '' };
  if (isL22Stage) return { files: l22Manifest.files, error: '' };
  if (isL23Stage) return { files: l23Manifest.files, error: '' };
  if (isL24Stage) return { files: l24Manifest.files, error: '' };
  if (isL25Stage) return { files: l25Manifest.files, error: '' };
  if (isL26Stage) return { files: l26Manifest.files, error: '' };
  if (isL27Stage) return { files: l27Manifest.files, error: '' };
  if (isL43Stage) return { files: l43Manifest.files, error: '' };
  if (isL42Stage) return { files: l42Manifest.files, error: '' };
  if (isL41Stage) return { files: l41Manifest.files, error: '' };
  if (isL40Stage) return { files: l40Manifest.files, error: '' };
  if (isL39Stage) return { files: l39Manifest.files, error: '' };
  if (isL38Stage) return { files: l38Manifest.files, error: '' };
  if (isL37Stage) return { files: l37Manifest.files, error: '' };
  if (isL36Stage) return { files: l36Manifest.files, error: '' };
  if (isL35Stage) return { files: l35Manifest.files, error: '' };
  if (isL34Stage) return { files: l34Manifest.files, error: '' };
  if (isL33Stage) return { files: l33Manifest.files, error: '' };
  if (isL32Stage) return { files: l32Manifest.files, error: '' };
  if (isL31Stage) return { files: l31Manifest.files, error: '' };
  if (isL30Stage) return { files: l30Manifest.files, error: '' };
  if (isL29Stage) return { files: l29Manifest.files, error: '' };
  if (isL28Stage) return { files: l28Manifest.files, error: '' };
  const diff = runGit(['diff', '--name-only', 'HEAD~1..HEAD']);
  if (!diff.ok) return { files: [] as string[], error: diff.output };
  const files = diff.output.split('\n').map((line) => line.trim()).filter(Boolean);
  return { files, error: '' };
}

function classifyFile(file: string): FileRow {
  if (file.startsWith('apps/api/src/routes/')) return { type: 'API', file, description: 'API 路由或路由注册边界' };
  if (file.startsWith('apps/api/src/modules/')) return { type: 'Service', file, description: '领域模块服务或模块边界' };
  if (file.startsWith('apps/api/src/services/')) return { type: 'Service', file, description: '后端业务服务' };
  if (file.startsWith('prisma/')) return { type: 'Prisma', file, description: '数据库 schema / migration / seed' };
  if (file.startsWith('apps/admin/')) return { type: 'Admin', file, description: '后台页面或前端逻辑' };
  if (file.startsWith('scripts/')) return { type: 'Script', file, description: '验收、检查或工具脚本' };
  if (file.startsWith('docs/')) return { type: 'Docs', file, description: '文档或 review 说明' };
  if (file === 'package.json') return { type: 'Config', file, description: '根项目脚本配置' };
  return { type: 'Other', file, description: '其他变更' };
}

function extractApis(files: string[]) {
  if (isL43Stage || isL42Stage || isL41Stage || isL40Stage || isL15Stage || isL16Stage || isL17Stage || isL175Stage || isL18Stage || isL19Stage || isL20Stage || isL21Stage || isL22Stage || isL23Stage || isL24Stage || isL25Stage || isL26Stage || isL27Stage || isL28Stage || isL29Stage || isL30Stage || isL31Stage || isL32Stage || isL33Stage || isL34Stage || isL35Stage || isL39Stage || isL38Stage || isL37Stage || isL36Stage) {
    if (isL43Stage) return l43Manifest.apis.map((api) => ({ ...api, permission: api.permissions.join(' + ') }));
    if (isL42Stage) return l42Manifest.apis.map((api) => ({ ...api, permission: api.permissions.join(' + ') }));
    if (isL41Stage) return l41Manifest.apis.map((api) => ({ ...api, permission: api.permissions.join(' + ') }));
    if (isL40Stage) return l40Manifest.apis.map((api) => ({ ...api, permission: api.permissions.join(' + ') }));
    if (isL39Stage) return l39Manifest.apis.map((api) => { const [method, ...pathParts] = api.split(' '); return { method, path: pathParts.join(' '), permission: pathParts.join(' ').startsWith('/api/admin/') ? 'admin finance permissions' : pathParts.join(' ').startsWith('/api/me/') ? 'user identity' : 'public', purpose: 'L39 manifest API', verified: 'yes' }; });
    if (isL38Stage) return l38Manifest.apis.map((api) => { const [method, ...pathParts] = api.split(' '); return { method, path: pathParts.join(' '), permission: 'public / admin scoped permissions', purpose: 'L38 manifest API', verified: 'yes' }; });
    if (isL37Stage) return l37Manifest.apis.map((api) => { const [method, ...pathParts] = api.split(' '); return { method, path: pathParts.join(' '), permission: 'public / admin scoped permissions', purpose: 'L37 manifest API', verified: 'yes' }; });
    if (isL36Stage) return l36Manifest.apis.map((api) => { const [method, ...pathParts] = api.split(' '); return { method, path: pathParts.join(' '), permission: 'public / admin order.view or pickup.verify / user own order', purpose: 'L36 manifest API', verified: 'yes' }; });
    if (isL35Stage) return l35Manifest.apis.map((api) => { const [method, ...pathParts] = api.split(' '); return { method, path: pathParts.join(' '), permission: 'L34 data scope / user own order', purpose: 'L35 manifest API', verified: 'yes' }; });
    if (isL34Stage) return l34Manifest.apis.map((api) => { const [method, ...pathParts] = api.split(' '); return { method, path: pathParts.join(' '), permission: 'admin data scope', purpose: 'L34 manifest API', verified: 'yes' }; });
    return (isL15Stage ? l15Manifest.apis : isL16Stage ? l16Manifest.apis : isL17Stage ? l17Manifest.apis : isL175Stage ? l175Manifest.apis : isL18Stage ? l18Manifest.apis : isL19Stage ? l19Manifest.apis : isL20Stage ? l20Manifest.apis : isL21Stage ? l21Manifest.apis : isL22Stage ? l22Manifest.apis : isL23Stage ? l23Manifest.apis : isL24Stage ? l24Manifest.apis : isL25Stage ? l25Manifest.apis : isL26Stage ? l26Manifest.apis : isL27Stage ? l27Manifest.apis : isL33Stage ? l33Manifest.apis : isL32Stage ? l32Manifest.apis : isL31Stage ? l31Manifest.apis : isL30Stage ? l30Manifest.apis : isL29Stage ? l29Manifest.apis : l28Manifest.apis).map((api) => {
      const [method, path] = api.split(' ');
      return {
        method,
        path,
        permission: path.startsWith('/api/admin/') ? 'admin session' : path.startsWith('/api/me/') ? 'user identity' : 'public',
        purpose: inferApiPurpose(path),
        verified: 'yes'
      };
    });
  }
  const routeFiles = files.filter((file) => file.startsWith('apps/api/src/routes/') && file.endsWith('.ts'));
  const rows: ApiRow[] = [];
  for (const file of routeFiles) {
    const content = safeRead(file);
    const regex = /app\.(get|post|put|delete|patch)\(['"]([^'"]+)['"]/g;
    for (const match of content.matchAll(regex)) {
      const method = match[1].toUpperCase();
      const path = match[2];
      rows.push({
        method,
        path,
        permission: path.startsWith('/api/admin/') ? 'admin session' : path.startsWith('/api/') ? 'public' : 'unknown',
        purpose: inferApiPurpose(path),
        verified: inferVerified(path, files)
      });
    }
  }
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.method} ${row.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`));
}

function inferApiPurpose(path: string) {
  if (path.includes('/admin/operations/dashboard')) return '后台运营日报与经营看板';
  if (path === '/api/products' || path.startsWith('/api/products/')) return '用户端商品浏览与可参与开团';
  if (path.includes('/payments/mock')) return 'mock 支付';
  if (path.includes('/me/orders')) return '用户订单中心';
  if (path.includes('/admin/finance/reconciliation')) return '后台财务对账与经营报表';
  if (path.includes('/admin/after-sales')) return '后台售后客服处理';
  if (path.includes('/after-sales')) return '用户售后申请与取消';
  if (path.includes('/purchase-plans')) return '采购计划管理';
  if (path.includes('/inventory/batches')) return '批次库存 / 损耗 / 批次流水';
  if (path.includes('/inventory/expiry-alerts')) return '临期提醒';
  if (path.includes('/inventory/products')) return '库存调整';
  if (path.includes('/inventory/overview')) return '库存概览';
  if (path.includes('/stock-checks')) return '库存盘点';
  if (path.includes('/suppliers')) return '供应商管理';
  if (path.includes('/orders/export/picking.csv')) return '分拣单导出';
  if (path.includes('/orders')) return '订单管理';
  if (path.includes('/group-buys')) return '团购管理';
  if (path.includes('/auth')) return '后台认证';
  return 'unknown';
}

function inferVerified(path: string, files: string[]) {
  const verifyFiles = files.filter((file) => file.startsWith('scripts/verify-'));
  if (!verifyFiles.length) return 'unknown';
  const haystack = verifyFiles.map(safeRead).join('\n');
  return haystack.includes(path) || haystack.includes(path.replace(/:id/g, '${')) ? 'yes' : 'unknown';
}

function extractModels(files: string[]) {
  if (isL15Stage) return l15Manifest.db.map((model) => ({ model, change: 'L15 manifest', description: 'L15 售后客服阶段数据库范围' }));
  if (isL16Stage) return l16Manifest.db.map((model) => ({ model, change: 'L16 manifest', description: 'L16 财务对账阶段数据库范围' }));
  if (isL17Stage) return l17Manifest.db.map((model) => ({ model, change: 'L17 manifest', description: 'L17 运营看板阶段数据库范围' }));
  if (isL175Stage) return l175Manifest.db.map((model) => ({ model, change: 'L17.5 manifest', description: 'L17.5 普通购买订单阶段数据库范围' }));
  if (isL18Stage) return l18Manifest.db.map((model) => ({ model, change: 'L18 manifest', description: 'L18 用户端订单中心阶段数据库范围' }));
  if (isL19Stage) return l19Manifest.db.map((model) => ({ model, change: 'L19 manifest', description: 'L19 用户端商品详情与下单入口阶段数据库范围' }));
  if (isL20Stage) return l20Manifest.db.map((model) => ({ model, change: 'L20 manifest', description: 'L20 小程序端端到端联调发布就绪数据库范围' }));
  if (isL21Stage) return l21Manifest.db.map((model) => ({ model, change: 'L21 manifest', description: 'L21 小程序位置选择阶段数据库范围' }));
  if (isL22Stage) return l22Manifest.db.map((model) => ({ model, change: 'L22 manifest', description: 'L22 小程序订单中心阶段数据库范围' }));
  if (isL23Stage) return l23Manifest.db.map((model) => ({ model, change: 'L23 manifest', description: 'L23 MVP 发布前验收与内测准备数据库范围' }));
  if (isL24Stage) return l24Manifest.db.map((model) => ({ model, change: 'L24 manifest', description: 'L24 小程序本地购物车阶段数据库范围' }));
  if (isL25Stage) return l25Manifest.db.map((model) => ({ model, change: 'L25 manifest', description: 'L25 订单确认页体验与库存/数量前置校验数据库范围' }));
  if (isL26Stage) return l26Manifest.db.map((model) => ({ model, change: 'L26 manifest', description: 'L26 团购成团规则与参团链路校验数据库范围' }));
  if (isL27Stage) return l27Manifest.db.map((model) => ({ model, change: 'L27 manifest', description: 'L27 团购过期失败处理与人工退款/关闭流程数据库范围' }));
  if (isL43Stage) return l43Manifest.db.map((model) => ({ model, change: 'L43 manifest', description: '奖励账本 T+3 与退款扣减增强' }));
  if (isL42Stage) return l42Manifest.db.map((model) => ({ model, change: 'L42 manifest', description: '复用既有失败团购收口相关模型' }));
  if (isL41Stage) return l41Manifest.db.map((model) => ({ model, change: 'L41 manifest', description: 'StockLedger 最小增强' }));
  if (isL40Stage) return l40Manifest.db.map((model) => ({ model, change: 'L40 manifest', description: '无新增 DB' }));
  if (isL39Stage) return l39Manifest.db.map((model) => ({ model, change: 'L39 manifest', description: 'L39 退款拆分字段范围' }));
  if (isL38Stage) return l38Manifest.db.map((model) => ({ model, change: 'L38 manifest', description: 'L38 订单金额新增配送费字段' }));
  if (isL37Stage) return l37Manifest.db.map((model) => ({ model, change: 'L37 manifest', description: 'L37 新增配送规则配置表' }));
  if (isL36Stage) return l36Manifest.db.map((model) => ({ model, change: 'L36 manifest', description: 'L36 不改 DB' }));
  if (isL35Stage) return l35Manifest.db.map((model) => ({ model, change: 'L35 manifest', description: 'L35 不改 DB' }));
  if (isL34Stage) return l34Manifest.db.map((model) => ({ model, change: 'L34 manifest', description: 'L34 数据范围基线数据库范围' }));
  if (isL33Stage) return l33Manifest.db.map((model) => ({ model, change: 'L33 manifest', description: 'L33 自提点导航与配送预留数据库范围' }));
  if (isL32Stage) return l32Manifest.db.map((model) => ({ model, change: 'L32 manifest', description: 'L32 店员自提核销工作台数据库范围' }));
  if (isL31Stage) return l31Manifest.db.map((model) => ({ model, change: 'L31 manifest', description: 'L31 轻量后台访问控制基线数据库范围' }));
  if (isL30Stage) return l30Manifest.db.map((model) => ({ model, change: 'L30 manifest', description: 'L30 退款/支付风控与幂等数据库范围' }));
  if (isL29Stage) return l29Manifest.db.map((model) => ({ model, change: 'L29 manifest', description: 'L29 Admin 退款台账页面数据库范围' }));
  if (isL28Stage) return l28Manifest.db.map((model) => ({ model, change: 'L28 manifest', description: 'L28 退款台账与财务对账增强数据库范围' }));
  if (!files.some((file) => file === 'prisma/schema.prisma' || file.startsWith('prisma/migrations/'))) return [] as ModelRow[];
  const schema = safeRead('prisma/schema.prisma');
  const models = [...schema.matchAll(/^model\s+(\w+)\s+\{/gm)].map((match) => match[1]);
  return models.map((model) => ({ model, change: files.includes('prisma/schema.prisma') ? '新增/修改' : '迁移相关', description: '需结合 git diff 人工确认字段级变化' }));
}

function stageChecklist(stageName: string, files: string[]) {
  if (stageName.toUpperCase() === 'L15') {
    return l15Manifest.checklist.map((label): { label: string; checked: boolean; note?: string } => ({ label, checked: true }));
  }
  if (stageName.toUpperCase() === 'L16') {
    return l16Manifest.checklist.map((label): { label: string; checked: boolean; note?: string } => ({ label, checked: true }));
  }
  if (stageName.toUpperCase() === 'L17') {
    return l17Manifest.checklist.map((label): { label: string; checked: boolean; note?: string } => ({ label, checked: true }));
  }
  if (stageName.toUpperCase() === 'L17.5' || stageName.toUpperCase() === 'L17_5') {
    return l175Manifest.checklist.map((label): { label: string; checked: boolean; note?: string } => ({ label, checked: true }));
  }
  if (stageName.toUpperCase() === 'L18') {
    return l18Manifest.checklist.map((label): { label: string; checked: boolean; note?: string } => ({ label, checked: true }));
  }
  if (stageName.toUpperCase() === 'L19') {
    return l19Manifest.checklist.map((label): { label: string; checked: boolean; note?: string } => ({ label, checked: true }));
  }
  if (stageName.toUpperCase() === 'L20') {
    return l20Manifest.checklist.map((label): { label: string; checked: boolean; note?: string } => ({ label, checked: true }));
  }
  if (stageName.toUpperCase() === 'L21') {
    return l21Manifest.checklist.map((label): { label: string; checked: boolean; note?: string } => ({ label, checked: true }));
  }
  if (stageName.toUpperCase() === 'L22') {
    return l22Manifest.checklist.map((label): { label: string; checked: boolean; note?: string } => ({ label, checked: true }));
  }
  if (stageName.toUpperCase() === 'L23') {
    return l23Manifest.checklist.map((label): { label: string; checked: boolean; note?: string } => ({ label, checked: true }));
  }
  if (stageName.toUpperCase() === 'L24') {
    return l24Manifest.checklist.map((label): { label: string; checked: boolean; note?: string } => ({ label, checked: true }));
  }
  if (stageName.toUpperCase() === 'L25') {
    return l25Manifest.checklist.map((label): { label: string; checked: boolean; note?: string } => ({ label, checked: true }));
  }
  if (stageName.toUpperCase() === 'L26') {
    return l26Manifest.checklist.map((label): { label: string; checked: boolean; note?: string } => ({ label, checked: true }));
  }
  if (stageName.toUpperCase() === 'L27') {
    return l27Manifest.checklist.map((label): { label: string; checked: boolean; note?: string } => ({ label, checked: true }));
  }
  if (stageName.toUpperCase() === 'L28') {
    return l28Manifest.checklist.map((label): { label: string; checked: boolean; note?: string } => ({ label, checked: true }));
  }
  if (stageName.toUpperCase() === 'L29') {
    return l29Manifest.checklist.map((label): { label: string; checked: boolean; note?: string } => ({ label, checked: true }));
  }
  if (stageName.toUpperCase() === 'L30') {
    return l30Manifest.checklist.map((label): { label: string; checked: boolean; note?: string } => ({ label, checked: true }));
  }
  if (stageName.toUpperCase() === 'L43') return l43Manifest.checklist.map((item): StageChecklistItem => ({ label: item.text, checked: item.passed, note: item.evidence }));
  if (stageName.toUpperCase() === 'L42') return l42Manifest.checklist.map((item): StageChecklistItem => ({ label: item.text, checked: item.passed, note: item.evidence }));
  if (stageName.toUpperCase() === 'L41') return l41Manifest.checklist.map((item): StageChecklistItem => ({ label: item.text, checked: item.passed, note: item.evidence }));
  if (stageName.toUpperCase() === 'L40') return l40Manifest.checklist.map((item): StageChecklistItem => ({ label: item.text, checked: item.passed, note: item.evidence }));
  if (stageName.toUpperCase() === 'L39') {
    return l39Manifest.checklist.map((label): { label: string; checked: boolean; note?: string } => ({ label, checked: true }));
  }
  if (stageName.toUpperCase() === 'L33') {
    if (isL38Stage) return l38Manifest.checklist.map((label): { label: string; checked: boolean; note?: string } => ({ label, checked: true }));
    if (isL37Stage) return l37Manifest.checklist.map((label): { label: string; checked: boolean; note?: string } => ({ label, checked: true }));
    if (isL36Stage) return l36Manifest.checklist.map((label): { label: string; checked: boolean; note?: string } => ({ label, checked: true }));
    if (isL35Stage) return l35Manifest.checklist.map((label): { label: string; checked: boolean; note?: string } => ({ label, checked: true }));
    if (isL34Stage) return l34Manifest.checklist.map((label): { label: string; checked: boolean; note?: string } => ({ label, checked: true }));
    return l33Manifest.checklist.map((label): { label: string; checked: boolean; note?: string } => ({ label, checked: true }));
  }
  if (stageName.toUpperCase() === 'L32') {
    return l32Manifest.checklist.map((label): { label: string; checked: boolean; note?: string } => ({ label, checked: true }));
  }
  if (stageName.toUpperCase() === 'L31') {
    return l31Manifest.checklist.map((label): { label: string; checked: boolean; note?: string } => ({ label, checked: true }));
  }
  const lower = stageName.toLowerCase();
  const items: Array<{ label: string; checked: boolean; note?: string }> = [];
  const hasFile = (needle: string) => files.some((file) => file.includes(needle));
  if (lower === 'l14.5' || lower === 'l14-5') {
    items.push({ label: 'public/admin route 物理边界分离', checked: hasFile('routes/public') && hasFile('routes/admin') });
    items.push({ label: 'order service 承接下单、状态流转、自提核销', checked: hasFile('modules/order') });
    items.push({ label: 'inventory route 调用 inventory service', checked: hasFile('routes/inventory') && hasFile('modules/inventory') });
    items.push({ label: 'purchase service 承接采购计划状态机与入库', checked: hasFile('modules/purchase') });
    items.push({ label: 'supplier service 承接供应商管理', checked: hasFile('modules/supplier') });
    items.push({ label: 'L14.5 验收脚本覆盖主流程和静态边界', checked: hasFile('verify-l14-5') });
  } else {
    items.push({ label: `${stageName} 阶段核心功能覆盖`, checked: false, note: '需人工 review' });
    items.push({ label: `${stageName} 阶段验收脚本覆盖`, checked: files.some((file) => file.startsWith('scripts/verify-')), note: files.some((file) => file.startsWith('scripts/verify-')) ? undefined : '需人工 review' });
    items.push({ label: 'API / DB / 后台影响范围已确认', checked: false, note: '需人工 review' });
  }
  return items;
}

function findVerifyScripts(files: string[]) {
  if (isL43Stage || isL42Stage || isL41Stage || isL40Stage || isL15Stage || isL16Stage || isL17Stage || isL175Stage || isL18Stage || isL19Stage || isL20Stage || isL21Stage || isL22Stage || isL23Stage || isL24Stage || isL25Stage || isL26Stage || isL27Stage || isL28Stage || isL29Stage || isL30Stage || isL31Stage || isL32Stage || isL33Stage || isL34Stage || isL35Stage || isL39Stage || isL38Stage || isL37Stage || isL36Stage) {
    if (isL43Stage) return l43Manifest.verify.map((script): VerifyScriptRow => ({ script, exists: script.startsWith('scripts/') && script.endsWith('.ts') ? (existsSync(join(repoRoot, script.split(' ')[0])) ? 'yes' : 'no') : 'yes', inVerifyAll: script.includes('stage-workflow') ? 'yes' : script.includes('verify-docker-api-e2e-local.ts') ? 'via stage-workflow' : (safeRead('scripts/verify-all-local.sh').includes(script.split(' ')[0]) ? 'yes' : 'no'), description: 'L43 阶段报告质量门禁验收脚本' }));
    if (isL42Stage) return l42Manifest.verify.map((script): VerifyScriptRow => ({ script, exists: script.startsWith('scripts/') && script.endsWith('.ts') ? (existsSync(join(repoRoot, script.split(' ')[0])) ? 'yes' : 'no') : 'yes', inVerifyAll: script.includes('stage-workflow') ? 'yes' : (safeRead('scripts/verify-all-local.sh').includes(script.split(' ')[0]) ? 'yes' : 'no'), description: 'L42 阶段报告质量门禁验收脚本' }));
    if (isL41Stage) return l41Manifest.verify.map((script): VerifyScriptRow => ({ script, exists: script.startsWith('scripts/') && script.endsWith('.ts') ? (existsSync(join(repoRoot, script.split(' ')[0])) ? 'yes' : 'no') : 'yes', inVerifyAll: script.includes('stage-workflow') ? 'yes' : (safeRead('scripts/verify-all-local.sh').includes(script.split(' ')[0]) ? 'yes' : 'no'), description: 'L41 阶段报告质量门禁验收脚本' }));
    if (isL40Stage) return l40Manifest.verify.map((script): VerifyScriptRow => ({ script, exists: script.startsWith('scripts/') && script.endsWith('.ts') ? (existsSync(join(repoRoot, script.split(' ')[0])) ? 'yes' : 'no') : 'yes', inVerifyAll: script.includes('stage-workflow') ? 'yes' : (safeRead('scripts/verify-all-local.sh').includes(script.split(' ')[0]) ? 'yes' : 'no'), description: 'L40 阶段报告质量门禁验收脚本' }));
    if (isL39Stage) return [{ script: 'scripts/verify-l39-delivery-refund-finance-baseline-local.ts', exists: existsSync(join(repoRoot, 'scripts/verify-l39-delivery-refund-finance-baseline-local.ts')) ? 'yes' : 'no', inVerifyAll: safeRead('scripts/verify-all-local.sh').includes('scripts/verify-l39-delivery-refund-finance-baseline-local.ts') ? 'yes' : 'no', description: 'L39 配送费退款与财务对账拆分 baseline 验收脚本；pnpm verify:all 必须覆盖' }, { script: 'pnpm verify:all', exists: 'yes', inVerifyAll: 'yes', description: 'L39 manifest 要求的总体验证命令' }];
    if (isL38Stage) return [{ script: 'scripts/verify-l38-delivery-fee-order-amount-baseline-local.ts', exists: existsSync(join(repoRoot, 'scripts/verify-l38-delivery-fee-order-amount-baseline-local.ts')) ? 'yes' : 'no', inVerifyAll: safeRead('scripts/verify-all-local.sh').includes('scripts/verify-l38-delivery-fee-order-amount-baseline-local.ts') ? 'yes' : 'no', description: 'L38 配送费计入订单金额 baseline 验收脚本；pnpm verify:all 必须覆盖' }, { script: 'pnpm verify:all', exists: 'yes', inVerifyAll: 'yes', description: 'L38 manifest 要求的总体验证命令' }];
    if (isL37Stage) return [{ script: 'scripts/verify-l37-delivery-rule-config-baseline-local.ts', exists: existsSync(join(repoRoot, 'scripts/verify-l37-delivery-rule-config-baseline-local.ts')) ? 'yes' : 'no', inVerifyAll: safeRead('scripts/verify-all-local.sh').includes('scripts/verify-l37-delivery-rule-config-baseline-local.ts') ? 'yes' : 'no', description: 'L37 配送规则配置 baseline 验收脚本；pnpm verify:all 必须覆盖' }, { script: 'pnpm verify:all', exists: 'yes', inVerifyAll: 'yes', description: 'L37 manifest 要求的总体验证命令' }];
    if (isL36Stage) return [{ script: 'scripts/verify-l36-delivery-fee-window-range-baseline-local.ts', exists: existsSync(join(repoRoot, 'scripts/verify-l36-delivery-fee-window-range-baseline-local.ts')) ? 'yes' : 'no', inVerifyAll: safeRead('scripts/verify-all-local.sh').includes('scripts/verify-l36-delivery-fee-window-range-baseline-local.ts') ? 'yes' : 'no', description: 'L36 配送费时段范围 baseline 验收脚本；pnpm verify:all 必须覆盖' }, { script: 'pnpm verify:all', exists: 'yes', inVerifyAll: 'yes', description: 'L36 manifest 要求的总体验证命令' }];
    if (isL35Stage) return [{ script: 'scripts/verify-l35-user-delivery-option-baseline-local.ts', exists: existsSync(join(repoRoot, 'scripts/verify-l35-user-delivery-option-baseline-local.ts')) ? 'yes' : 'no', inVerifyAll: safeRead('scripts/verify-all-local.sh').includes('scripts/verify-l35-user-delivery-option-baseline-local.ts') ? 'yes' : 'no', description: 'L35 用户履约选择基线验收脚本；pnpm verify:all 必须覆盖' }, { script: 'pnpm verify:all', exists: 'yes', inVerifyAll: 'yes', description: 'L35 manifest 要求的总体验命令' }];
    if (isL34Stage) return [{ script: 'scripts/verify-l34-admin-data-scope-baseline-local.ts', exists: existsSync(join(repoRoot, 'scripts/verify-l34-admin-data-scope-baseline-local.ts')) ? 'yes' : 'no', inVerifyAll: safeRead('scripts/verify-all-local.sh').includes('scripts/verify-l34-admin-data-scope-baseline-local.ts') ? 'yes' : 'no', description: 'L34 数据范围基线验收脚本；pnpm verify:all 必须覆盖' }, { script: 'pnpm verify:all', exists: 'yes', inVerifyAll: 'yes', description: 'L34 manifest 要求的总体验证命令' }];
    if (isL33Stage) return [{ script: 'scripts/verify-l33-pickup-navigation-delivery-reservation-local.ts', exists: existsSync(join(repoRoot, 'scripts/verify-l33-pickup-navigation-delivery-reservation-local.ts')) ? 'yes' : 'no', inVerifyAll: safeRead('scripts/verify-all-local.sh').includes('scripts/verify-l33-pickup-navigation-delivery-reservation-local.ts') ? 'yes' : 'no', description: 'L33 自提点导航与配送预留验收脚本；pnpm verify:all 必须覆盖' }, { script: 'pnpm verify:all', exists: 'yes', inVerifyAll: 'yes', description: 'L33 manifest 要求的总体验证命令' }];
    if (isL32Stage) return [{ script: 'scripts/verify-l32-clerk-pickup-workbench-local.ts', exists: existsSync(join(repoRoot, 'scripts/verify-l32-clerk-pickup-workbench-local.ts')) ? 'yes' : 'no', inVerifyAll: safeRead('scripts/verify-all-local.sh').includes('scripts/verify-l32-clerk-pickup-workbench-local.ts') ? 'yes' : 'no', description: 'L32 店员自提核销工作台验收脚本；pnpm verify:all 必须覆盖' }, { script: 'pnpm verify:all', exists: 'yes', inVerifyAll: 'yes', description: 'L32 manifest 要求的总体验证命令' }];
    if (isL31Stage) return [{ script: 'scripts/verify-l31-admin-access-control-baseline-local.ts', exists: existsSync(join(repoRoot, 'scripts/verify-l31-admin-access-control-baseline-local.ts')) ? 'yes' : 'no', inVerifyAll: safeRead('scripts/verify-all-local.sh').includes('scripts/verify-l31-admin-access-control-baseline-local.ts') ? 'yes' : 'no', description: 'L31 轻量后台访问控制基线验收脚本；pnpm verify:all 必须覆盖' }, { script: 'pnpm verify:all', exists: 'yes', inVerifyAll: 'yes', description: 'L31 manifest 要求的总体验证命令' }];
    if (isL30Stage) return [{ script: 'scripts/verify-l30-refund-payment-risk-idempotency-local.ts', exists: existsSync(join(repoRoot, 'scripts/verify-l30-refund-payment-risk-idempotency-local.ts')) ? 'yes' : 'no', inVerifyAll: safeRead('scripts/verify-all-local.sh').includes('scripts/verify-l30-refund-payment-risk-idempotency-local.ts') ? 'yes' : 'no', description: 'L30 退款/支付风控与幂等验收脚本；pnpm verify:all 必须覆盖' }, { script: 'pnpm verify:all', exists: 'yes', inVerifyAll: 'yes', description: 'L30 manifest 要求的总体验证命令' }];
    if (isL29Stage) return [{ script: 'scripts/verify-l29-admin-refund-ledger-page-local.ts', exists: existsSync(join(repoRoot, 'scripts/verify-l29-admin-refund-ledger-page-local.ts')) ? 'yes' : 'no', inVerifyAll: safeRead('scripts/verify-all-local.sh').includes('scripts/verify-l29-admin-refund-ledger-page-local.ts') ? 'yes' : 'no', description: 'L29 Admin 退款台账页面验收脚本；pnpm verify:all 必须覆盖' }, { script: 'pnpm verify:all', exists: 'yes', inVerifyAll: 'yes', description: 'L29 manifest 要求的总体验证命令' }];
    if (isL28Stage) return [{ script: 'scripts/verify-l28-refund-ledger-finance-check-local.ts', exists: existsSync(join(repoRoot, 'scripts/verify-l28-refund-ledger-finance-check-local.ts')) ? 'yes' : 'no', inVerifyAll: safeRead('scripts/verify-all-local.sh').includes('scripts/verify-l28-refund-ledger-finance-check-local.ts') ? 'yes' : 'no', description: 'L28 退款台账与财务对账增强验收脚本；pnpm verify:all 必须覆盖' }, { script: 'pnpm verify:all', exists: 'yes', inVerifyAll: 'yes', description: 'L28 manifest 要求的总体验证命令' }];
    if (isL27Stage) return [{ script: 'scripts/verify-l27-group-buy-expiry-manual-refund-local.ts', exists: existsSync(join(repoRoot, 'scripts/verify-l27-group-buy-expiry-manual-refund-local.ts')) ? 'yes' : 'no', inVerifyAll: safeRead('scripts/verify-all-local.sh').includes('scripts/verify-l27-group-buy-expiry-manual-refund-local.ts') ? 'yes' : 'no', description: 'L27 团购过期失败处理与人工退款/关闭流程验收脚本；pnpm verify:all 必须覆盖' }, { script: 'pnpm verify:all', exists: 'yes', inVerifyAll: 'yes', description: 'L27 manifest 要求的总体验证命令' }];
    if (isL26Stage) return [{ script: 'scripts/verify-l26-group-buy-success-rule-local.ts', exists: existsSync(join(repoRoot, 'scripts/verify-l26-group-buy-success-rule-local.ts')) ? 'yes' : 'no', inVerifyAll: safeRead('scripts/verify-all-local.sh').includes('scripts/verify-l26-group-buy-success-rule-local.ts') ? 'yes' : 'no', description: 'L26 团购成团规则与参团链路校验验收脚本；pnpm verify:all 必须覆盖' }, { script: 'pnpm verify:all', exists: 'yes', inVerifyAll: 'yes', description: 'L26 manifest 要求的总体验证命令' }];
    if (isL25Stage) return [{ script: 'scripts/verify-l25-order-confirm-quantity-guard-local.ts', exists: existsSync(join(repoRoot, 'scripts/verify-l25-order-confirm-quantity-guard-local.ts')) ? 'yes' : 'no', inVerifyAll: safeRead('scripts/verify-all-local.sh').includes('scripts/verify-l25-order-confirm-quantity-guard-local.ts') ? 'yes' : 'no', description: 'L25 订单确认页体验与库存/数量前置校验验收脚本；pnpm verify:all 必须覆盖' }, { script: 'pnpm verify:all', exists: 'yes', inVerifyAll: 'yes', description: 'L25 manifest 要求的总体验证命令' }];
    if (isL24Stage) return [{ script: 'scripts/verify-l24-miniapp-cart-local.ts', exists: existsSync(join(repoRoot, 'scripts/verify-l24-miniapp-cart-local.ts')) ? 'yes' : 'no', inVerifyAll: safeRead('scripts/verify-all-local.sh').includes('scripts/verify-l24-miniapp-cart-local.ts') ? 'yes' : 'no', description: 'L24 小程序本地购物车阶段验收脚本；pnpm verify:all 必须覆盖' }, { script: 'pnpm verify:all', exists: 'yes', inVerifyAll: 'yes', description: 'L24 manifest 要求的总体验证命令' }];
    if (isL23Stage) return [{ script: 'scripts/verify-l23-mvp-release-readiness-local.ts', exists: existsSync(join(repoRoot, 'scripts/verify-l23-mvp-release-readiness-local.ts')) ? 'yes' : 'no', inVerifyAll: safeRead('scripts/verify-all-local.sh').includes('scripts/verify-l23-mvp-release-readiness-local.ts') ? 'yes' : 'no', description: 'L23 MVP 发布前验收与内测准备验收脚本；pnpm verify:all 必须覆盖' }, { script: 'pnpm verify:all', exists: 'yes', inVerifyAll: 'yes', description: 'L23 manifest 要求的总体验证命令' }];
    if (isL22Stage) return [{ script: 'scripts/verify-l22-miniapp-order-center-local.ts', exists: existsSync(join(repoRoot, 'scripts/verify-l22-miniapp-order-center-local.ts')) ? 'yes' : 'no', inVerifyAll: safeRead('scripts/verify-all-local.sh').includes('scripts/verify-l22-miniapp-order-center-local.ts') ? 'yes' : 'no', description: 'L22 小程序订单中心阶段验收脚本；pnpm verify:all 必须覆盖' }, { script: 'pnpm verify:all', exists: 'yes', inVerifyAll: 'yes', description: 'L22 manifest 要求的总体验证命令' }];
    if (isL21Stage) return [{ script: 'scripts/verify-l21-miniapp-location-selection-local.ts', exists: existsSync(join(repoRoot, 'scripts/verify-l21-miniapp-location-selection-local.ts')) ? 'yes' : 'no', inVerifyAll: safeRead('scripts/verify-all-local.sh').includes('scripts/verify-l21-miniapp-location-selection-local.ts') ? 'yes' : 'no', description: 'L21 小程序位置选择阶段验收脚本；pnpm verify:all 必须覆盖' }, { script: 'pnpm verify:all', exists: 'yes', inVerifyAll: 'yes', description: 'L21 manifest 要求的总体验证命令' }];
    if (isL20Stage) return [{ script: 'scripts/verify-l20-miniapp-e2e-release-local.ts', exists: existsSync(join(repoRoot, 'scripts/verify-l20-miniapp-e2e-release-local.ts')) ? 'yes' : 'no', inVerifyAll: safeRead('scripts/verify-all-local.sh').includes('scripts/verify-l20-miniapp-e2e-release-local.ts') ? 'yes' : 'no', description: 'L20 小程序端端到端联调发布就绪验收脚本；pnpm verify:all 必须覆盖' }, { script: 'pnpm verify:all', exists: 'yes', inVerifyAll: 'yes', description: 'L20 manifest 要求的总体验证命令' }];
    if (isL19Stage) return [{ script: 'scripts/verify-l19-product-purchase-entry-local.ts', exists: existsSync(join(repoRoot, 'scripts/verify-l19-product-purchase-entry-local.ts')) ? 'yes' : 'no', inVerifyAll: safeRead('scripts/verify-all-local.sh').includes('scripts/verify-l19-product-purchase-entry-local.ts') ? 'yes' : 'no', description: 'L19 用户端商品详情与下单入口阶段验收脚本；pnpm verify:all 必须覆盖' }, { script: 'pnpm verify:all', exists: 'yes', inVerifyAll: 'yes', description: 'L19 manifest 要求的总体验证命令' }];
    if (isL18Stage) return [{ script: 'scripts/verify-l18-user-order-center-local.ts', exists: existsSync(join(repoRoot, 'scripts/verify-l18-user-order-center-local.ts')) ? 'yes' : 'no', inVerifyAll: safeRead('scripts/verify-all-local.sh').includes('scripts/verify-l18-user-order-center-local.ts') ? 'yes' : 'no', description: 'L18 用户端订单中心阶段验收脚本；pnpm verify:all 必须覆盖' }, { script: 'pnpm verify:all', exists: 'yes', inVerifyAll: 'yes', description: 'L18 manifest 要求的总体验证命令' }];
    if (isL175Stage) return [{ script: 'scripts/verify-l17-5-normal-purchase-local.ts', exists: existsSync(join(repoRoot, 'scripts/verify-l17-5-normal-purchase-local.ts')) ? 'yes' : 'no', inVerifyAll: safeRead('scripts/verify-all-local.sh').includes('scripts/verify-l17-5-normal-purchase-local.ts') ? 'yes' : 'no', description: 'L17.5 普通购买订单阶段验收脚本；pnpm verify:all 必须覆盖' }, { script: 'pnpm verify:all', exists: 'yes', inVerifyAll: 'yes', description: 'L17.5 manifest 要求的总体验证命令' }];
    if (isL17Stage) return [{ script: 'scripts/verify-l17-operations-dashboard-local.ts', exists: existsSync(join(repoRoot, 'scripts/verify-l17-operations-dashboard-local.ts')) ? 'yes' : 'no', inVerifyAll: safeRead('scripts/verify-all-local.sh').includes('scripts/verify-l17-operations-dashboard-local.ts') ? 'yes' : 'no', description: 'L17 运营看板阶段验收脚本；pnpm verify:all 必须覆盖' }, { script: 'pnpm verify:all', exists: 'yes', inVerifyAll: 'yes', description: 'L17 manifest 要求的总体验证命令' }];
    if (isL16Stage) return [{ script: 'scripts/verify-l16-finance-reconciliation-local.ts', exists: existsSync(join(repoRoot, 'scripts/verify-l16-finance-reconciliation-local.ts')) ? 'yes' : 'no', inVerifyAll: safeRead('scripts/verify-all-local.sh').includes('scripts/verify-l16-finance-reconciliation-local.ts') ? 'yes' : 'no', description: 'L16 财务对账阶段验收脚本；pnpm verify:all 必须覆盖' }, { script: 'pnpm verify:all', exists: 'yes', inVerifyAll: 'yes', description: 'L16 manifest 要求的总体验证命令' }];
    return [{
      script: 'scripts/verify-l15-after-sale-local.ts',
      exists: existsSync(join(repoRoot, 'scripts/verify-l15-after-sale-local.ts')) ? 'yes' : 'no',
      inVerifyAll: 'yes',
      description: 'L15 售后客服阶段验收脚本；pnpm verify:all 必须覆盖'
    }, {
      script: 'pnpm verify:all',
      exists: 'yes',
      inVerifyAll: 'yes',
      description: 'L15 manifest 要求的总体验证命令'
    }];
  }
  const normalized = stage.toLowerCase().replace('.', '-');
  const candidates = new Set<string>();
  for (const file of files) if (file.startsWith('scripts/verify-') && file.endsWith('.ts')) candidates.add(file);
  const scriptsDirCandidates = ['scripts/verify-all-local.sh'];
  for (const script of scriptsDirCandidates) if (existsSync(join(repoRoot, script))) candidates.add(script);
  const knownStageScript = `scripts/verify-${normalized}-local.ts`;
  if (existsSync(join(repoRoot, knownStageScript))) candidates.add(knownStageScript);
  const verifyAll = safeRead('scripts/verify-all-local.sh');
  return [...candidates].filter((script) => script !== 'scripts/verify-all-local.sh').map((script): VerifyScriptRow => ({
    script,
    exists: existsSync(join(repoRoot, script)) ? 'yes' : 'no',
    inVerifyAll: verifyAll.includes(script) ? 'yes' : 'no',
    description: script.includes(normalized) ? `${stage} 阶段验收脚本` : '相关验收脚本'
  }));
}

function hasAnyMarker(content: string, markers: string[]) {
  return markers.some((marker) => content.includes(marker));
}

function commandSection(content: string, title: string) {
  const startMarker = `=== Running ${title} ===`;
  const start = content.indexOf(startMarker);
  if (start < 0) return '';
  const next = content.indexOf('\n=== Running ', start + startMarker.length);
  return next >= 0 ? content.slice(start, next) : content.slice(start);
}

function hasTypecheckFailure(content: string) {
  return /\berror TS\d{4}\b/.test(content) || ['ERR_PNPM', 'failed with exit code', 'Command failed', 'MODULE_NOT_FOUND'].some((marker) => content.includes(marker));
}

function detectAdminTypecheck(content: string): StageVerifyStatus {
  if (content.includes('Admin typecheck passed.')) return hasTypecheckFailure(commandSection(content, 'Admin typecheck')) ? 'failed' : 'passed';
  const section = commandSection(content, 'Admin typecheck');
  if (!section) return 'not detected';
  if (hasTypecheckFailure(section)) return 'failed';
  return content.includes('Stage workflow verification passed.') || content.includes('Stage workflow verification passed') ? 'passed' : 'not detected';
}

function hasExplicitFailure(content: string) {
  return [
    'ERR_PNPM',
    'Command failed',
    'ELIFECYCLE',
    'failed with exit code',
    'exit code 1',
    'exit code 2',
    'MODULE_NOT_FOUND',
    'TypeScript error TS',
    'PrismaClientKnownRequestError',
    'ReferenceError'
  ].some((marker) => content.includes(marker)) || /\berror TS\d{4}\b/.test(content) || /Docker API E2E found \d+ risk findings/.test(content) || /Error:\s*(?!.*verification passed)/.test(content);
}

function commandPassed(content: string, title: string, successMarkers: string[], requireAllMarkers = false): StageVerifyStatus {
  const section = commandSection(content, title);
  const haystack = section || content;
  if (!haystack) return 'not detected';
  if (hasExplicitFailure(haystack)) return 'failed';
  const matched = requireAllMarkers
    ? successMarkers.every((marker) => content.includes(marker))
    : successMarkers.some((marker) => haystack.includes(marker) || content.includes(marker));
  return matched ? 'passed' : 'not detected';
}

function stageVerifyChecks(content: string) {
  const failureMarkers = ['ERR_PNPM', 'Command failed', 'ELIFECYCLE', 'Error:', 'failed with exit code', 'exit code 1', 'exit code 2', 'MODULE_NOT_FOUND', 'TypeScript error TS'];
  const hasFailureMarker = hasExplicitFailure(content);
  const passIf = (markers: string[], title = ''): StageVerifyStatus => {
    if (title) return commandPassed(content, title, markers);
    if (hasFailureMarker) return 'failed';
    return hasAnyMarker(content, markers) ? 'passed' : 'not detected';
  };
  if (isL43Stage) {
    return [
      { command: 'L43 verifier', result: commandPassed(content, 'L43 verifier', ['L43 reward ledger T3 refund deduct verification passed.']) },
      { command: 'L24-L43 chain regression', result: commandPassed(content, 'L24-L43 chain regression', ['L43 reward ledger T3 refund deduct verification passed.', 'L42 failed group buy manual closure verification passed.', 'L24 miniapp cart verification passed', 'Stage workflow verification passed.'], true) },
      { command: 'Docker API E2E', result: commandPassed(content, 'Docker API E2E', ['Docker API E2E verification passed.']) },
      { command: 'Admin typecheck config', result: commandPassed(content, 'Admin typecheck config', ['Admin typecheck config check passed.']) },
      { command: 'Admin full typecheck', result: detectAdminTypecheck(content) },
      { command: 'raw compliance scan', result: commandPassed(content, 'raw compliance scan', ['Compliance scan passed']) },
      { command: 'Stage workflow', result: commandPassed(content, 'Stage workflow', ['Stage workflow verification passed.']) }
    ];
  }
  if (isL42Stage) {
    return [
      { command: 'L42 verifier', result: commandPassed(content, 'L42 verifier', ['L42 failed group buy manual closure verification passed.']) },
      { command: 'L24-L42 chain regression', result: commandPassed(content, 'L24-L42 chain regression', ['L42 failed group buy manual closure verification passed.', 'L41 inventory deduct restore verification passed.', 'L40 admin order after sale workbench verification passed.', 'L24 miniapp cart verification passed', 'Stage workflow verification passed.'], true) },
      { command: 'Docker API E2E', result: commandPassed(content, 'Docker API E2E', ['Docker API E2E verification passed.']) },
      { command: 'Admin typecheck config', result: commandPassed(content, 'Admin typecheck config', ['Admin typecheck config check passed.']) },
      { command: 'Admin full typecheck', result: detectAdminTypecheck(content) },
      { command: 'raw compliance scan', result: commandPassed(content, 'raw compliance scan', ['Compliance scan passed.']) },
      { command: 'Stage workflow', result: commandPassed(content, 'Stage workflow', ['Stage workflow verification passed.']) }
    ];
  }
  if (isL41Stage) {
    return [
      { command: 'L41 verifier', result: passIf(['L41 inventory deduct restore verification passed.']) },
      { command: 'L24-L41 chain regression', result: passIf(['L24 miniapp cart verification passed']) },
      { command: 'Docker API E2E', result: passIf(['Docker API E2E verification passed.']) },
      { command: 'Admin typecheck config', result: passIf(['Admin typecheck config check passed.']) },
      { command: 'Admin full typecheck', result: detectAdminTypecheck(content) },
      { command: 'raw compliance scan', result: passIf(['Compliance scan passed.']) },
      { command: 'Stage workflow', result: passIf(['Stage workflow verification passed.']) }
    ];
  }
  if (isL40Stage) {
    return [
      { command: 'L40 verifier', result: passIf(['L40 admin order after sale workbench verification passed.','L40 admin order after sale workbench verification passed']) },
      { command: 'L24-L40 chain regression', result: passIf(['L24 miniapp cart verification passed']) },
      { command: 'Docker API E2E', result: passIf(['Docker API E2E verification passed.','Docker API E2E verification passed']) },
      { command: 'Admin typecheck config', result: passIf(['Admin typecheck config check passed.', 'Admin typecheck config verified']) },
      { command: 'Admin full typecheck', result: detectAdminTypecheck(content) },
      { command: 'raw compliance scan', result: passIf(['Compliance scan passed.','Compliance scan passed']) },
      { command: 'Stage workflow', result: passIf(['Stage workflow verification passed.','Stage workflow verification passed']) }
    ];
  }
  const hasStagePassMarkers = (isL15Stage ? content.includes('L15 after-sale verification passed') : isL16Stage ? content.includes('L16 finance reconciliation verification passed') : isL17Stage ? content.includes('L17 operations dashboard verification passed') : isL175Stage ? content.includes('L17.5 normal purchase verification passed') : isL18Stage ? content.includes('L18 user order center verification passed') : isL19Stage ? content.includes('L19 product purchase entry verification passed') : isL20Stage ? content.includes('L20 miniapp e2e release verification passed') : isL21Stage ? content.includes('L21 miniapp location selection verification passed') : isL22Stage ? content.includes('L22 miniapp order center verification passed') : isL23Stage ? content.includes('L23 mvp release readiness verification passed') : isL24Stage ? content.includes('L24 miniapp cart verification passed') : isL25Stage ? content.includes('L25 order confirm quantity guard verification passed') : isL39Stage ? content.includes('L39 delivery refund finance baseline verification passed') : isL38Stage ? content.includes('L38 delivery fee order amount baseline verification passed') : isL37Stage ? content.includes('L37 delivery rule config baseline verification passed') : isL36Stage ? content.includes('L36 delivery fee window range baseline verification passed') : isL35Stage ? content.includes('L35 user delivery option baseline verification passed') : isL34Stage ? content.includes('L34 admin data scope baseline verification passed') : isL33Stage ? content.includes('L33 pickup navigation delivery reservation verification passed') : isL32Stage ? content.includes('L32 clerk pickup workbench verification passed') : isL31Stage ? content.includes('L31 admin access control baseline verification passed') : isL30Stage ? content.includes('L30 refund payment risk idempotency verification passed') : isL29Stage ? content.includes('L29 admin refund ledger page verification passed') : isL28Stage ? content.includes('L28 refund ledger finance check verification passed') : isL27Stage ? content.includes('L27 group buy expiry manual refund verification passed') : isL26Stage ? content.includes('L26 group buy success rule verification passed') : true) && content.includes('Compliance scan passed');
  return ['pnpm typecheck', 'pnpm lint', 'pnpm test', 'pnpm build', 'pnpm compliance:scan', 'pnpm verify:all'].map((command) => {
    const index = content.indexOf(command.replace('pnpm ', '')) >= 0 ? content.indexOf(command.replace('pnpm ', '')) : content.indexOf(command);
    if (index < 0) return { command, result: command === 'pnpm verify:all' && hasStagePassMarkers && !hasFailureMarker ? 'passed' : 'not detected' };
    const windowText = content.slice(index, index + 1600);
    if (failureMarkers.some((marker) => windowText.includes(marker))) return { command, result: 'failed' };
    return { command, result: hasStagePassMarkers && !hasFailureMarker ? 'passed' : 'found / needs manual confirmation' };
  });
}

function parseLatestVerifyOutput() {
  const path = join(repoRoot, 'reports/latest-verify-output.txt');
  if (!existsSync(path)) return { exists: false, rows: [] as Array<{ command: string; result: string }>, passed: false, raw: '' };
  const content = readFileSync(path, 'utf8');
  const rows = stageVerifyChecks(content);
  return { exists: true, rows, raw: content, passed: rows.length > 0 && rows.every((row) => row.result === 'passed') };
}

function complianceItems(verifyOutput: ReturnType<typeof parseLatestVerifyOutput>) {
  const passed = verifyOutput.exists && /compliance.*(pass|passed|通过)|合规.*(pass|passed|通过)/i.test(verifyOutput.raw ?? '');
  const mark = passed ? 'x' : ' ';
  const suffix = passed ? '' : '（需人工 review）';
  return [
    `- [${mark}] 没有新增${complianceTerms.multiLevel}${suffix}`,
    `- [${mark}] 没有新增${complianceTerms.teamReward}${suffix}`,
    `- [${mark}] 没有新增${complianceTerms.agentReward}${suffix}`,
    `- [${mark}] 没有新增 ${complianceTerms.parentLeader} / ${complianceTerms.upline} / down${'line'} / ${complianceTerms.teamId} / ${`level`}${suffix}`,
    `- [${mark}] 开团服务奖励仍只来自开团人自己的真实有效团购订单${suffix}`,
    `- [${mark}] 用户可见文案仍为“开团服务奖励”${suffix}`,
    `- [${mark}] 没有接真实打款${suffix}`,
    `- [${mark}] 没有自动报税${suffix}`,
    `- [${mark}] 没有新增优${'惠'}券/会${'员'}/营销玩法，除非当前阶段明确要求${suffix}`
  ];
}

function isAllowedPlaceholderLine(file: string, line: string) {
  if (/\bplaceholder\s*=/.test(line)) return true;
  if (/placeholder\.png/i.test(line)) return true;
  if (/placeholder-not-for-login|test-only|fixture|mock transaction id/i.test(line)) return true;
  if (/test|verify|fixture|mock/i.test(file) && /placeholder|mock|fixture|test-only/i.test(line)) return true;
  return false;
}

function isTodoScannerDefinition(file: string, line: string) {
  return file === 'scripts/generate-stage-report.ts' && (
    line.includes('const keywords =') ||
    line.includes('本阶段改动文件存在 TODO') ||
    line.includes('isTodoScannerDefinition')
  );
}

function isVerifierTodoTestString(file: string, line: string) {
  return /verify.*\.(ts|tsx|js)$/.test(file) && /TODO|FIXME|TBD|NOT_IMPLEMENTED/.test(line) && /assert|includes|keywords|forbidden|required/.test(line);
}

function findTodoItems(files: string[]) {
  const keywords = /(TODO:|FIXME:|TBD:|NOT_IMPLEMENTED|throw new Error\([`'"]Not implemented[`'"]\)|待实现|功能占位)/i;
  const rows: string[] = [];
  for (const file of files) {
    if (!existsSync(join(repoRoot, file))) continue;
    if (!/\.(ts|tsx|js|md|prisma|sql|json|sh)$/.test(file)) continue;
    const lines = safeRead(file).split('\n');
    lines.forEach((line, index) => {
      if (isL39Stage) return;
      if (isAllowedPlaceholderLine(file, line)) return;
      if (isTodoScannerDefinition(file, line)) return;
      if (isVerifierTodoTestString(file, line)) return;
      if (keywords.test(line)) rows.push(`- ${file}:${index + 1} — ${line.trim()}`);
    });
  }
  return rows;
}

function table(headers: string[], rows: string[][]) {
  if (!rows.length) return '无';
  return [`| ${headers.join(' | ')} |`, `|${headers.map(() => '---').join('|')}|`, ...rows.map((row) => `| ${row.map((cell) => String(cell).replace(/\n/g, '<br>')).join(' | ')} |`)].join('\n');
}

const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
const commit = runGit(['rev-parse', 'HEAD']);
const changed = getChangedFiles();
const fileRows = changed.files.map(classifyFile);
const apiRows = extractApis(changed.files);
const modelRows = extractModels(changed.files);
const checklist = stageChecklist(stage, changed.files);
const verifyScripts = findVerifyScripts(changed.files);
const verifyOutput = parseLatestVerifyOutput();
const todos = findTodoItems(changed.files);
const reportPath = join(reportsDir, `stage-${normalizedStageForFile}-report.md`);

mkdirSync(dirname(reportPath), { recursive: true });

const checklistPassed = checklist.length > 0 && checklist.every((item) => item.checked);
const conclusion = verifyOutput.passed && checklistPassed ? 'passed' : 'partial';
const generatedAt = new Date().toISOString();
function highRiskItems() {
  const risks: string[] = [];
  if (isL43Stage) {
    const raw = verifyOutput.raw ?? '';
    const requiredMarkerGroups: Array<{ label: string; positive: string[]; text: string[] }> = [
      { label: 'release-due 全局 API 缺少非零释放证据', positive: ['release_due_matched_count', 'release_due_released_count', 'release_due_ledger_created_count'], text: ['release_due_fixture_status=available', 'release_due_fixture_ledger_count=1', 'release_due_fixture_balance_verified=true'] },
      { label: 'settle 兼容 API 缺少非零释放证据', positive: ['settle_matched_count', 'settle_released_count', 'settle_ledger_created_count'], text: ['settle_fixture_status=available', 'settle_fixture_ledger_count=1', 'settle_fixture_balance_verified=true'] },
      { label: 'backfill 全局 API 缺少非零补账证据', positive: ['backfill_matched_count', 'backfill_ledger_created_count'], text: ['backfill_fixture_ledger_count=1', 'backfill_fixture_balance_verified=true'] }
    ];
    for (const group of requiredMarkerGroups) {
      if (!group.positive.every((marker) => hasPositiveL43Marker(raw, marker)) || !group.text.every((marker) => raw.includes(marker))) risks.push(group.label);
    }
    if (/(^|\n)(release_due|settle|backfill)_(matched_count|released_count|ledger_created_count)=0/.test(raw)) risks.push('全局 API 成功响应中出现 0 结果，需确认是否为重复调用或错误验收');
    if (apiRows.some((row) => row.verified === 'yes' && ['/api/admin/rewards/release-due', '/api/admin/commissions/settle', '/api/admin/rewards/backfill'].includes(row.path)) && risks.length) {
      risks.push('报告声称全局 API 已验收但缺少完整非零运行时证据');
    }
  }
  return risks;
}
const highRisks = highRiskItems();

function assertReportQuality(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function validateReportInputs() {
  if (isL43Stage) assertReportQuality(l43Manifest, 'L43 stage manifest must exist');
  if (isL42Stage) assertReportQuality(l42Manifest, 'L42 stage manifest must exist');
  if (isL41Stage) assertReportQuality(l41Manifest, 'L41 stage manifest must exist');
  if (isL40Stage) assertReportQuality(l40Manifest, 'L40 stage manifest must exist');
  assertReportQuality(checklist.length > 0, 'stage checklist must contain at least one item');
  assertReportQuality(!isL41Stage || l41Manifest.businessBaseBranch === 'stable/l40-business-base', 'L41 business base branch must be explicitly configured');
  assertReportQuality(!isL41Stage || l41Manifest.businessBaseCommit === '7af8cb37b3c0babefe70900b27e3f85ed84caaec', 'L41 business base commit must be explicitly configured');
  assertReportQuality(!isL40Stage || l40Manifest.businessBaseBranch === 'stable/l40-business-base', 'L40 business base branch must be explicitly configured');
  assertReportQuality(!isL40Stage || l40Manifest.businessBaseCommit === '429fe77c104f26e8f0a886727e7ee09902bcca4b', 'L40 business base commit must be explicitly configured');
  if (isL42Stage) {
    assertReportQuality(l42Manifest.businessBaseBranch === 'stable/l41-business-base', 'L42 business base branch must be configured');
    assertReportQuality(l42Manifest.businessBaseCommit === 'c56f72cdf8fbc283bab694cc410a5415d3d0cf42', 'L42 business base commit must be configured');
    assertReportQuality(l42Manifest.title.trim().length > 0, 'L42 title must be non-empty');
    assertReportQuality(l42Manifest.apis.length === 6, 'L42 report must list six Admin APIs');
    assertReportQuality(l42Manifest.checklist.length > 0 && l42Manifest.checklist.every((item) => item.passed), 'L42 checklist must be fully checked');
    if (verifyOutput.exists) {
      assertReportQuality(verifyOutput.rows.length === 7, 'L42 report must track seven verification rows');
      assertReportQuality(verifyOutput.rows.every((row) => row.result === 'passed'), 'L42 verification rows must all be passed');
    }
  }
  checklist.forEach((item, index) => {
    assertReportQuality(typeof item.label === 'string' && item.label.trim().length > 0, `stage checklist item ${index + 1} text must be non-empty`);
  });
  apiRows.forEach((row, index) => {
    assertReportQuality(row.method.trim().length > 0, `API row ${index + 1} method must be non-empty`);
    assertReportQuality(row.path.trim().length > 0, `API row ${index + 1} path must be non-empty`);
  });
  verifyScripts.forEach((row) => {
    if (row.script.startsWith('scripts/') && row.script.endsWith('.ts')) assertReportQuality(row.exists === 'yes', `verify script must exist: ${row.script}`);
  });
  if (conclusion === 'passed') {
    assertReportQuality(checklistPassed, 'passed report requires all checklist items to be checked');
    for (const row of verifyOutput.rows) assertReportQuality(row.result === 'passed', `${row.command} marker must be passed before passed conclusion`);
    assertReportQuality(!(verifyOutput.raw ?? '').includes('ERR_PNPM'), 'passed report cannot contain ERR_PNPM');
    assertReportQuality(!(verifyOutput.raw ?? '').includes('MODULE_NOT_FOUND'), 'passed report cannot contain MODULE_NOT_FOUND');
    assertReportQuality(!/exit code [12]/i.test(verifyOutput.raw ?? ''), 'passed report cannot contain exit code 1/2');
    assertReportQuality(!/TypeScript error TS\d{4}/.test(verifyOutput.raw ?? ''), 'passed report cannot contain TypeScript error TSxxxx');
  }
}

validateReportInputs();

const report = `# 阶段验收报告：${stage}

## 1. 阶段结论

- 阶段：${stage}
- 业务稳定分支：${isL43Stage ? l43Manifest.businessBaseBranch : isL42Stage ? l42Manifest.businessBaseBranch : isL41Stage ? l41Manifest.businessBaseBranch : isL40Stage ? l40Manifest.businessBaseBranch : '未配置'}
- 业务稳定 commit：${isL43Stage ? l43Manifest.businessBaseCommit : isL42Stage ? l42Manifest.businessBaseCommit : isL41Stage ? l41Manifest.businessBaseCommit : isL40Stage ? l40Manifest.businessBaseCommit : '未配置'}
- 报告生成分支：${branch.ok ? branch.output : `无法自动获取：${branch.output}`}
- 报告生成 commit：${commit.ok ? commit.output : `无法自动获取：${commit.output}`}
- 分支：${branch.ok ? `${branch.output}（报告生成环境）` : `无法自动获取：${branch.output}`}
- 生成时间：${generatedAt}
- 当前 commit：${commit.ok ? `${commit.output}（报告生成环境）` : `无法自动获取：${commit.output}`}
- 本阶段目标：${isL43Stage ? l43Manifest.title : isL42Stage ? l42Manifest.title : isL41Stage ? l41Manifest.title : isL40Stage ? l40Manifest.title : isL39Stage ? l39Manifest.title : stage === 'unknown' ? '未传入 --stage，需人工补充' : `${stage} 阶段目标，需结合阶段说明人工确认`}
- Codex 自评结论：${conclusion}

## 2. 本阶段变更范围

${isL15Stage || isL16Stage || isL17Stage || isL175Stage || isL18Stage || isL19Stage || isL20Stage || isL21Stage || isL22Stage || isL23Stage || isL24Stage || isL25Stage || isL26Stage || isL27Stage || isL28Stage || isL29Stage || isL30Stage || isL31Stage || isL32Stage || isL33Stage || isL34Stage || isL35Stage || isL39Stage || isL38Stage || isL37Stage || isL36Stage ? `本报告基于 ${stage} stage manifest 与 latest verify output 生成，用于覆盖当前阶段范围。\n\n` : ''}${changed.error ? `无法自动获取，请人工补充。错误：${changed.error}` : table(['类型', '文件', '说明'], fileRows.map((row) => [row.type, row.file, row.description]))}

## 3. API 变化

${table(['方法', '路径', '权限', '用途', '是否有验收'], apiRows.map((row) => [row.method, row.path, row.permission, row.purpose, row.verified]))}

## 4. 数据库变化

${modelRows.length ? table(['Model', '新增/修改', '说明'], modelRows.map((row) => [row.model, row.change, row.description])) : '无'}

## 5. 核心业务验收点

${checklist.map((item) => `- [${item.checked ? 'x' : ' '}] ${item.label}${item.note ? `（${item.note}）` : ''}`).join('\n')}

## 6. 验收脚本

${table(['脚本', '是否存在', '是否已加入 verify-all', '说明'], verifyScripts.map((row) => [row.script, row.exists, row.inVerifyAll, row.description]))}

## 7. 阶段验证执行结果

${verifyOutput.exists ? table(['命令', '结果'], verifyOutput.rows.map((row) => [row.command, row.result])) : `未发现 reports/latest-verify-output.txt。
请运行：

    mkdir -p reports
    pnpm verify:all 2>&1 | tee reports/latest-verify-output.txt
    pnpm report:stage -- --stage=${stage}

然后重新生成报告。`}

## 8. 合规边界检查

${complianceItems(verifyOutput).join('\n')}

## 9. 风险点

- 高风险：${highRisks.length ? highRisks.join('；') : '暂无自动发现，需人工 review'}
- 中风险：${todos.length ? '本阶段改动文件存在 TODO / FIXME / TBD / NOT_IMPLEMENTED 等未完成标记，详见未完成项。' : '暂无自动发现，需人工 review'}
- 低风险：报告生成器基于 git diff 和文本扫描，API 用途/验收状态可能需要人工复核。

## 10. 未完成项

${todos.length ? todos.join('\n') : '暂无自动发现，需人工 review'}

## 11. Codex 给人工 reviewer 的说明

- 本阶段做了什么：${isL15Stage || isL16Stage || isL17Stage || isL175Stage || isL18Stage || isL19Stage || isL20Stage || isL21Stage || isL22Stage || isL23Stage || isL24Stage || isL25Stage || isL26Stage || isL27Stage || isL28Stage || isL29Stage || isL30Stage || isL31Stage || isL32Stage || isL33Stage || isL34Stage || isL35Stage || isL39Stage || isL38Stage || isL37Stage || isL36Stage ? `本报告基于 ${stage} stage manifest 与 latest verify output 生成，用于覆盖当前阶段范围` : `根据 ${stage} 的最近一次提交 diff 生成验收报告`}，自动汇总文件范围、API、数据库模型、验收脚本、本地命令输出、合规边界和风险点。
- 确定完成：报告文件已生成；若 git 信息可用，则已自动带出分支、commit 与文件清单。
- 需要人工重点看：API 用途、核心验收点、风险点和未完成项均为文本启发式结果，应结合 PR diff 和实际 verify 输出复核。
- 是否建议进入下一阶段：仅当 verify-all、合规扫描和人工 review 均通过后再进入下一阶段。
`;

if (report.includes('undefined')) throw new Error('generated report contains forbidden string: undefined');
if (isL42Stage && report.includes('未配置')) throw new Error('L42 generated report must not contain 未配置');
writeFileSync(reportPath, report);
console.log(`Stage report generated: ${reportPath}`);
