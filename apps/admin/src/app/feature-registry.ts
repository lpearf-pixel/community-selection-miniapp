import type { AdminViewKey } from './admin-view';

export type AdminFeatureSection =
  | 'catalog'
  | 'sales'
  | 'fulfillment'
  | 'inventory'
  | 'membership'
  | 'finance'
  | 'operations'
  | 'system';

export type AdminFeatureDefinition = {
  key: Exclude<AdminViewKey, 'login'>;
  label: string;
  section: AdminFeatureSection;
  requiredPermissions: readonly string[];
};

export const ADMIN_FEATURES = [
  { key: 'products', label: '商品管理', section: 'catalog', requiredPermissions: ['catalog.read'] },
  { key: 'groupBuys', label: '团购管理', section: 'sales', requiredPermissions: ['group-buy.read'] },
  { key: 'failedGroupBuyClosure', label: '失败团购人工关闭', section: 'sales', requiredPermissions: ['group-buy.close'] },
  { key: 'orders', label: '订单管理', section: 'sales', requiredPermissions: ['order.read'] },
  { key: 'fulfillment', label: '履约看板', section: 'fulfillment', requiredPermissions: ['fulfillment.read'] },
  { key: 'inventory', label: '库存管理', section: 'inventory', requiredPermissions: ['inventory.read'] },
  { key: 'purchasePlans', label: '采购计划', section: 'inventory', requiredPermissions: ['purchase.read'] },
  { key: 'suppliers', label: '供应商管理', section: 'inventory', requiredPermissions: ['supplier.read'] },
  { key: 'batches', label: '批次库存', section: 'inventory', requiredPermissions: ['inventory.batch.read'] },
  { key: 'expiryAlerts', label: '临期提醒', section: 'inventory', requiredPermissions: ['inventory.expiry.read'] },
  { key: 'stockChecks', label: '库存盘点', section: 'inventory', requiredPermissions: ['inventory.check.read'] },
  { key: 'afterSales', label: '售后客服', section: 'sales', requiredPermissions: ['after-sale.read'] },
  { key: 'withdrawals', label: '提现管理', section: 'finance', requiredPermissions: ['withdrawal.read'] },
  { key: 'alerts', label: '告警中心', section: 'operations', requiredPermissions: ['ops.alert.read'] },
  { key: 'taxRecords', label: '税务人工 Review', section: 'finance', requiredPermissions: ['tax.read'] },
  { key: 'dashboardV2', label: '经营驾驶舱 V2', section: 'operations', requiredPermissions: ['dashboard.read'] },
  { key: 'finance', label: '财务对账', section: 'finance', requiredPermissions: ['finance.read'] },
  { key: 'refundLedger', label: '退款台账', section: 'finance', requiredPermissions: ['refund.read'] },
  { key: 'rewardLedger', label: '开团服务奖励', section: 'finance', requiredPermissions: ['reward.read'] },
  { key: 'operations', label: '运营看板', section: 'operations', requiredPermissions: ['operations.read'] },
  { key: 'pickupWorkbench', label: '自提工作台', section: 'fulfillment', requiredPermissions: ['pickup.read'] },
  { key: 'deliveryReservation', label: '配送预留', section: 'fulfillment', requiredPermissions: ['delivery.read'] },
  { key: 'deliveryRuleConfig', label: '管理配送规则', section: 'fulfillment', requiredPermissions: ['delivery.rule.read'] },
] as const satisfies readonly AdminFeatureDefinition[];
