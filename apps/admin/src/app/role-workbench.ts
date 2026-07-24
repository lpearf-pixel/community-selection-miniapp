import type { AdminViewKey } from './admin-view';
import { ADMIN_FEATURES } from './feature-registry';

export type RoleWorkbenchKey =
  | 'owner'
  | 'store'
  | 'inventory'
  | 'customer-service'
  | 'finance'
  | 'system'
  | 'general';

export type RoleWorkbenchAction = {
  target: Exclude<AdminViewKey, 'login'>;
  label: string;
};

export type RoleWorkbenchProfile = {
  key: RoleWorkbenchKey;
  label: string;
  description: string;
  actions: readonly RoleWorkbenchAction[];
};

type WorkbenchTarget = RoleWorkbenchAction['target'];

const labelByTarget = new Map<WorkbenchTarget, string>(
  ADMIN_FEATURES.map((feature) => [feature.key, feature.label]),
);

function actions(targets: readonly WorkbenchTarget[]): RoleWorkbenchAction[] {
  return targets.map((target) => ({
    target,
    label: labelByTarget.get(target) ?? target,
  }));
}

const profiles: Record<RoleWorkbenchKey, RoleWorkbenchProfile> = {
  owner: {
    key: 'owner',
    label: '经营负责人',
    description: '优先查看订单、库存、财务与经营异常。',
    actions: actions(['orders', 'inventory', 'finance', 'alerts']),
  },
  store: {
    key: 'store',
    label: '门店负责人',
    description: '优先处理门店订单、履约、库存、效期与异常。',
    actions: actions([
      'orders',
      'fulfillment',
      'inventory',
      'expiryAlerts',
      'alerts',
    ]),
  },
  inventory: {
    key: 'inventory',
    label: '库存与采购',
    description: '优先处理库存、采购、批次、效期与盘点。',
    actions: actions([
      'inventory',
      'purchasePlans',
      'batches',
      'expiryAlerts',
      'stockChecks',
    ]),
  },
  'customer-service': {
    key: 'customer-service',
    label: '客服与履约',
    description: '优先处理订单、售后、自提与配送问题。',
    actions: actions([
      'orders',
      'afterSales',
      'pickupWorkbench',
      'deliveryReservation',
    ]),
  },
  finance: {
    key: 'finance',
    label: '财务与结算',
    description: '优先处理财务、退款、提现与税务复核。',
    actions: actions([
      'finance',
      'refundLedger',
      'withdrawals',
      'taxRecords',
    ]),
  },
  system: {
    key: 'system',
    label: '系统与风控',
    description: '优先查看告警、经营分析与系统运行状态。',
    actions: actions(['alerts', 'dashboardV2', 'operations']),
  },
  general: {
    key: 'general',
    label: '综合运营',
    description: '从订单、商品、库存与异常开始处理今日工作。',
    actions: actions(['orders', 'products', 'inventory', 'alerts']),
  },
};

const profileByRole: Record<string, RoleWorkbenchKey> = {
  admin: 'owner',
  owner: 'owner',
  organization_admin: 'owner',
  super_admin: 'owner',
  store_manager: 'store',
  inventory_operator: 'inventory',
  customer_service: 'customer-service',
  finance_operator: 'finance',
  finance_auditor: 'finance',
  system_admin: 'system',
  risk_operator: 'system',
};

export function createRoleWorkbenchModel(
  role: string,
): RoleWorkbenchProfile {
  const normalizedRole = role.trim().toLowerCase();
  return profiles[profileByRole[normalizedRole] ?? 'general'];
}
