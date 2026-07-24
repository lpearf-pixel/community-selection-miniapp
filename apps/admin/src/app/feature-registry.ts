import type { AdminViewKey } from './admin-view';

export type AdminFeatureSection =
  | 'today'
  | 'sales-fulfillment'
  | 'catalog-pricing'
  | 'inventory-supply'
  | 'membership-marketing'
  | 'stores-channels'
  | 'finance-settlement'
  | 'analytics'
  | 'operations-risk'
  | 'system-management';

export type AdminNavigationSectionDefinition = {
  key: AdminFeatureSection;
  label: string;
};

export type AdminFeatureDefinition = {
  key: Exclude<AdminViewKey, 'login'>;
  label: string;
  section: AdminFeatureSection;
  requiredPermissions: readonly string[];
};

export const ADMIN_NAVIGATION_SECTIONS = [
  { key: 'today', label: '今日经营' },
  { key: 'sales-fulfillment', label: '销售与履约' },
  { key: 'catalog-pricing', label: '商品与价格' },
  { key: 'inventory-supply', label: '库存与供应链' },
  { key: 'membership-marketing', label: '会员与营销' },
  { key: 'stores-channels', label: '门店与渠道' },
  { key: 'finance-settlement', label: '财务与结算' },
  { key: 'analytics', label: '数据分析' },
  { key: 'operations-risk', label: '运维与风控' },
  { key: 'system-management', label: '系统管理' },
] as const satisfies readonly AdminNavigationSectionDefinition[];

export const ADMIN_FEATURES = [
  { key: 'products', label: '商品管理', section: 'catalog-pricing', requiredPermissions: ['catalog.read'] },
  { key: 'groupBuys', label: '团购管理', section: 'sales-fulfillment', requiredPermissions: ['group-buy.read'] },
  { key: 'failedGroupBuyClosure', label: '失败团购人工关闭', section: 'sales-fulfillment', requiredPermissions: ['group-buy.close'] },
  { key: 'orders', label: '订单管理', section: 'sales-fulfillment', requiredPermissions: ['order.read'] },
  { key: 'fulfillment', label: '履约看板', section: 'sales-fulfillment', requiredPermissions: ['fulfillment.read'] },
  { key: 'inventory', label: '库存管理', section: 'inventory-supply', requiredPermissions: ['inventory.read'] },
  { key: 'purchasePlans', label: '采购计划', section: 'inventory-supply', requiredPermissions: ['purchase.read'] },
  { key: 'suppliers', label: '供应商管理', section: 'inventory-supply', requiredPermissions: ['supplier.read'] },
  { key: 'batches', label: '批次库存', section: 'inventory-supply', requiredPermissions: ['inventory.batch.read'] },
  { key: 'expiryAlerts', label: '临期提醒', section: 'inventory-supply', requiredPermissions: ['inventory.expiry.read'] },
  { key: 'stockChecks', label: '库存盘点', section: 'inventory-supply', requiredPermissions: ['inventory.check.read'] },
  { key: 'afterSales', label: '售后客服', section: 'sales-fulfillment', requiredPermissions: ['after-sale.read'] },
  { key: 'withdrawals', label: '提现管理', section: 'finance-settlement', requiredPermissions: ['withdrawal.read'] },
  { key: 'alerts', label: '告警中心', section: 'operations-risk', requiredPermissions: ['ops.alert.read'] },
  { key: 'taxRecords', label: '税务人工 Review', section: 'finance-settlement', requiredPermissions: ['tax.read'] },
  { key: 'dashboardV2', label: '经营驾驶舱 V2', section: 'analytics', requiredPermissions: ['dashboard.read'] },
  { key: 'finance', label: '财务对账', section: 'finance-settlement', requiredPermissions: ['finance.read'] },
  { key: 'refundLedger', label: '退款台账', section: 'finance-settlement', requiredPermissions: ['refund.read'] },
  { key: 'rewardLedger', label: '开团服务奖励', section: 'finance-settlement', requiredPermissions: ['reward.read'] },
  { key: 'operations', label: '运营看板', section: 'today', requiredPermissions: ['operations.read'] },
  { key: 'pickupWorkbench', label: '自提工作台', section: 'sales-fulfillment', requiredPermissions: ['pickup.read'] },
  { key: 'deliveryReservation', label: '配送预留', section: 'sales-fulfillment', requiredPermissions: ['delivery.read'] },
  { key: 'deliveryRuleConfig', label: '管理配送规则', section: 'sales-fulfillment', requiredPermissions: ['delivery.rule.read'] },
] as const satisfies readonly AdminFeatureDefinition[];
