import { describe, expect, it } from 'vitest';
import { ADMIN_VIEW_KEYS } from './admin-view';
import { ADMIN_FEATURES } from './feature-registry';
import { createRoleWorkbenchModel } from './role-workbench';

describe('role workbench model', () => {
  it.each(['admin', 'owner', 'organization_admin', 'super_admin'])(
    'maps %s to the owner workbench',
    (role) => {
      expect(createRoleWorkbenchModel(role)).toMatchObject({
        key: 'owner',
        label: '经营负责人',
        actions: [
          { target: 'orders', label: '订单管理' },
          { target: 'inventory', label: '库存管理' },
          { target: 'finance', label: '财务对账' },
          { target: 'alerts', label: '告警中心' },
        ],
      });
    },
  );

  it.each([
    [
      'store_manager',
      'store',
      ['orders', 'fulfillment', 'inventory', 'expiryAlerts', 'alerts'],
    ],
    [
      'inventory_operator',
      'inventory',
      ['inventory', 'purchasePlans', 'batches', 'expiryAlerts', 'stockChecks'],
    ],
    [
      'customer_service',
      'customer-service',
      ['orders', 'afterSales', 'pickupWorkbench', 'deliveryReservation'],
    ],
    [
      'finance_operator',
      'finance',
      ['finance', 'refundLedger', 'withdrawals', 'taxRecords'],
    ],
    [
      'finance_auditor',
      'finance',
      ['finance', 'refundLedger', 'withdrawals', 'taxRecords'],
    ],
    ['system_admin', 'system', ['alerts', 'dashboardV2', 'operations']],
    ['risk_operator', 'system', ['alerts', 'dashboardV2', 'operations']],
  ] as const)(
    'maps %s to the %s workbench',
    (role, expectedKey, expectedTargets) => {
      const model = createRoleWorkbenchModel(role);

      expect(model.key).toBe(expectedKey);
      expect(model.actions.map((action) => action.target)).toEqual(
        expectedTargets,
      );
    },
  );

  it('normalizes case and surrounding whitespace', () => {
    expect(createRoleWorkbenchModel('  STORE_MANAGER  ').key).toBe('store');
  });

  it.each(['', 'unknown_role'])(
    'uses the general workbench for %j',
    (role) => {
      expect(createRoleWorkbenchModel(role)).toMatchObject({
        key: 'general',
        label: '综合运营',
        actions: [
          { target: 'orders', label: '订单管理' },
          { target: 'products', label: '商品管理' },
          { target: 'inventory', label: '库存管理' },
          { target: 'alerts', label: '告警中心' },
        ],
      });
    },
  );

  it('uses only registered non-login targets and their exact labels', () => {
    const validTargets = new Set(
      ADMIN_VIEW_KEYS.filter((key) => key !== 'login'),
    );
    const labelByTarget = new Map(
      ADMIN_FEATURES.map((feature) => [feature.key, feature.label]),
    );

    for (const role of [
      'admin',
      'store_manager',
      'inventory_operator',
      'customer_service',
      'finance_operator',
      'system_admin',
      'unknown_role',
    ]) {
      for (const action of createRoleWorkbenchModel(role).actions) {
        expect(validTargets.has(action.target)).toBe(true);
        expect(action.label).toBe(labelByTarget.get(action.target));
      }
    }
  });
});
