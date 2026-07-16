export const DASHBOARD_OPERATIONS_PERMISSIONS = ['operations.view', 'order.view', 'pickup.verify', 'after_sale.manage', 'product.manage'] as const;
export const DASHBOARD_FINANCE_PERMISSIONS = ['finance.view', 'refund.view', 'reward.view', 'withdrawal.view'] as const;
export const DASHBOARD_DEFAULT_TIMEZONE = 'Asia/Shanghai';
export const DASHBOARD_LOW_STOCK_THRESHOLD = 10;
export type DashboardQuery = { from?: string; to?: string; community_id?: string; pickup_store_id?: string; timezone?: string; limit?: string; expiring_days?: string };
