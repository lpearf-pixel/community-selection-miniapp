import { describe, expect, it } from 'vitest';
import {
  ADMIN_VIEW_KEYS,
  DEFAULT_ADMIN_VIEW,
  type AdminViewKey,
} from './admin-view';

describe('admin view contract', () => {
  it('keeps every L49 view key exactly once', () => {
    expect(ADMIN_VIEW_KEYS).toEqual([
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
    ]);
    expect(new Set(ADMIN_VIEW_KEYS).size).toBe(ADMIN_VIEW_KEYS.length);
  });

  it('uses today operations as the authenticated landing view', () => {
    const landing: AdminViewKey = DEFAULT_ADMIN_VIEW;
    expect(landing).toBe('operations');
  });
});
