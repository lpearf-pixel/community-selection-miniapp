export const ADMIN_VIEW_KEYS = [
  'login',
  'products',
  'groupBuys',
  'failedGroupBuyClosure',
  'orders',
  'fulfillment',
  'inventory',
  'purchasePlans',
  'suppliers',
  'batches',
  'expiryAlerts',
  'stockChecks',
  'afterSales',
  'withdrawals',
  'alerts',
  'taxRecords',
  'finance',
  'refundLedger',
  'rewardLedger',
  'operations',
  'pickupWorkbench',
  'deliveryReservation',
  'deliveryRuleConfig',
  'dashboardV2',
] as const;

export type AdminViewKey = (typeof ADMIN_VIEW_KEYS)[number];

export const DEFAULT_ADMIN_VIEW: AdminViewKey = 'products';
