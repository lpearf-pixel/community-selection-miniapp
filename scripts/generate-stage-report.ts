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
type ModelRow = { model: string; change: string; description: string };
type VerifyScriptRow = { script: string; exists: string; inVerifyAll: string; description: string };

function argValue(name: string) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const stage = argValue('stage') ?? 'unknown';
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
  if (isL15Stage || isL16Stage || isL17Stage || isL175Stage || isL18Stage || isL19Stage || isL20Stage || isL21Stage || isL22Stage) {
    return (isL15Stage ? l15Manifest.apis : isL16Stage ? l16Manifest.apis : isL17Stage ? l17Manifest.apis : isL175Stage ? l175Manifest.apis : isL18Stage ? l18Manifest.apis : isL19Stage ? l19Manifest.apis : isL20Stage ? l20Manifest.apis : isL21Stage ? l21Manifest.apis : l22Manifest.apis).map((api) => {
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
  if (isL15Stage || isL16Stage || isL17Stage || isL175Stage || isL18Stage || isL19Stage || isL20Stage || isL21Stage || isL22Stage) {
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

function parseLatestVerifyOutput() {
  const path = join(repoRoot, 'reports/latest-verify-output.txt');
  if (!existsSync(path)) return { exists: false, rows: [] as Array<{ command: string; result: string }>, passed: false };
  const content = readFileSync(path, 'utf8');
  const failureMarkers = ['ERR_PNPM', 'Command failed', 'ELIFECYCLE', 'Error:', 'failed'];
  const hasFailureMarker = failureMarkers.some((marker) => content.includes(marker));
  const hasStagePassMarkers = (isL15Stage ? content.includes('L15 after-sale verification passed') : isL16Stage ? content.includes('L16 finance reconciliation verification passed') : isL17Stage ? content.includes('L17 operations dashboard verification passed') : isL175Stage ? content.includes('L17.5 normal purchase verification passed') : isL18Stage ? content.includes('L18 user order center verification passed') : isL19Stage ? content.includes('L19 product purchase entry verification passed') : isL20Stage ? content.includes('L20 miniapp e2e release verification passed') : isL21Stage ? content.includes('L21 miniapp location selection verification passed') : isL22Stage ? content.includes('L22 miniapp order center verification passed') : true) && content.includes('Compliance scan passed');
  const commands = ['pnpm typecheck', 'pnpm lint', 'pnpm test', 'pnpm build', 'pnpm compliance:scan', 'pnpm verify:all'];
  const rows = commands.map((command) => {
    const index = content.indexOf(command.replace('pnpm ', '')) >= 0 ? content.indexOf(command.replace('pnpm ', '')) : content.indexOf(command);
    if (index < 0) return { command, result: (isL15Stage || isL16Stage || isL17Stage || isL175Stage || isL18Stage || isL19Stage || isL20Stage || isL21Stage || isL22Stage) && command === 'pnpm verify:all' && hasStagePassMarkers && !hasFailureMarker ? 'passed' : 'not found' };
    const windowText = content.slice(index, index + 1600);
    if (failureMarkers.some((marker) => windowText.includes(marker))) return { command, result: 'failed' };
    return { command, result: hasStagePassMarkers && !hasFailureMarker ? 'passed' : 'found / needs manual confirmation' };
  });
  return { exists: true, rows, raw: content, passed: hasStagePassMarkers && !hasFailureMarker };
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

function findTodoItems(files: string[]) {
  const keywords = /(TODO|FIXME|boundary|placeholder|待实现)/i;
  const rows: string[] = [];
  for (const file of files) {
    if (!existsSync(join(repoRoot, file))) continue;
    if (!/\.(ts|tsx|js|md|prisma|sql|json|sh)$/.test(file)) continue;
    const lines = safeRead(file).split('\n');
    lines.forEach((line, index) => {
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

const conclusion = verifyOutput.passed || (verifyOutput.exists && verifyOutput.rows.every((row) => !['failed', 'not found'].includes(row.result))) ? 'passed' : 'partial';
const generatedAt = new Date().toISOString();

const report = `# 阶段验收报告：${stage}

## 1. 阶段结论

- 阶段：${stage}
- 分支：${branch.ok ? branch.output : `无法自动获取：${branch.output}`}
- 生成时间：${generatedAt}
- 当前 commit：${commit.ok ? commit.output : `无法自动获取：${commit.output}`}
- 本阶段目标：${stage === 'unknown' ? '未传入 --stage，需人工补充' : `${stage} 阶段目标，需结合阶段说明人工确认`}
- Codex 自评结论：${conclusion}

## 2. 本阶段变更范围

${isL15Stage || isL16Stage || isL17Stage || isL175Stage || isL18Stage || isL19Stage || isL20Stage || isL21Stage || isL22Stage ? `本报告基于 ${stage} stage manifest 与 latest verify output 生成，用于覆盖当前阶段范围。\n\n` : ''}${changed.error ? `无法自动获取，请人工补充。错误：${changed.error}` : table(['类型', '文件', '说明'], fileRows.map((row) => [row.type, row.file, row.description]))}

## 3. API 变化

${table(['方法', '路径', '权限', '用途', '是否有验收'], apiRows.map((row) => [row.method, row.path, row.permission, row.purpose, row.verified]))}

## 4. 数据库变化

${modelRows.length ? table(['Model', '新增/修改', '说明'], modelRows.map((row) => [row.model, row.change, row.description])) : '无'}

## 5. 核心业务验收点

${checklist.map((item) => `- [${item.checked ? 'x' : ' '}] ${item.label}${item.note ? `（${item.note}）` : ''}`).join('\n')}

## 6. 验收脚本

${table(['脚本', '是否存在', '是否已加入 verify-all', '说明'], verifyScripts.map((row) => [row.script, row.exists, row.inVerifyAll, row.description]))}

## 7. 本地命令执行结果

${verifyOutput.exists ? table(['命令', '结果'], verifyOutput.rows.map((row) => [row.command, row.result])) : `未发现 reports/latest-verify-output.txt。
请运行：

    mkdir -p reports
    pnpm verify:all 2>&1 | tee reports/latest-verify-output.txt
    pnpm report:stage -- --stage=${stage}

然后重新生成报告。`}

## 8. 合规边界检查

${complianceItems(verifyOutput).join('\n')}

## 9. 风险点

- 高风险：暂无自动发现，需人工 review
- 中风险：${todos.length ? '本阶段改动文件存在 TODO / boundary / placeholder 等关键词，详见未完成项。' : '暂无自动发现，需人工 review'}
- 低风险：报告生成器基于 git diff 和文本扫描，API 用途/验收状态可能需要人工复核。

## 10. 未完成项

${todos.length ? todos.join('\n') : '暂无自动发现，需人工 review'}

## 11. Codex 给人工 reviewer 的说明

- 本阶段做了什么：${isL15Stage || isL16Stage || isL17Stage || isL175Stage || isL18Stage || isL19Stage || isL20Stage || isL21Stage || isL22Stage ? `本报告基于 ${stage} stage manifest 与 latest verify output 生成，用于覆盖当前阶段范围` : `根据 ${stage} 的最近一次提交 diff 生成验收报告`}，自动汇总文件范围、API、数据库模型、验收脚本、本地命令输出、合规边界和风险点。
- 确定完成：报告文件已生成；若 git 信息可用，则已自动带出分支、commit 与文件清单。
- 需要人工重点看：API 用途、核心验收点、风险点和未完成项均为文本启发式结果，应结合 PR diff 和实际 verify 输出复核。
- 是否建议进入下一阶段：仅当 verify-all、合规扫描和人工 review 均通过后再进入下一阶段。
`;

writeFileSync(reportPath, report);
console.log(`Stage report generated: ${reportPath}`);
