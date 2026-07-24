import { describe, expect, it } from 'vitest';
import { ADMIN_VIEW_KEYS } from './admin-view';
import {
  ADMIN_FEATURES,
  ADMIN_NAVIGATION_SECTIONS,
} from './feature-registry';
import {
  buildGroupedNavigation,
  buildLegacyNavigation,
} from './navigation';

describe('admin feature registry', () => {
  it('maps every non-login view exactly once', () => {
    const expected = ADMIN_VIEW_KEYS.filter((key) => key !== 'login');
    const actual = ADMIN_FEATURES.map((feature) => feature.key);
    expect(new Set(actual)).toEqual(new Set(expected));
    expect(new Set(actual).size).toBe(actual.length);
  });

  it('defines the ten approved top-level modules in order', () => {
    expect(
      ADMIN_NAVIGATION_SECTIONS.map(({ key, label }) => [key, label]),
    ).toEqual([
      ['today', '今日经营'],
      ['sales-fulfillment', '销售与履约'],
      ['catalog-pricing', '商品与价格'],
      ['inventory-supply', '库存与供应链'],
      ['membership-marketing', '会员与营销'],
      ['stores-channels', '门店与渠道'],
      ['finance-settlement', '财务与结算'],
      ['analytics', '数据分析'],
      ['operations-risk', '运维与风控'],
      ['system-management', '系统管理'],
    ]);
  });

  it('projects every current page into exactly one module', () => {
    const groups = buildGroupedNavigation();
    const groupedKeys = groups.flatMap((group) =>
      group.items.map((item) => item.key),
    );

    expect(groups).toHaveLength(10);
    expect(new Set(groupedKeys)).toEqual(
      new Set(ADMIN_FEATURES.map((feature) => feature.key)),
    );
    expect(new Set(groupedKeys).size).toBe(ADMIN_FEATURES.length);
  });

  it('preserves the L49 navigation labels and order', () => {
    expect(buildLegacyNavigation().map(({ key, label }) => [key, label]))
      .toEqual([
        ['products', '商品管理'],
        ['groupBuys', '团购管理'],
        ['failedGroupBuyClosure', '失败团购人工关闭'],
        ['orders', '订单管理'],
        ['fulfillment', '履约看板'],
        ['inventory', '库存管理'],
        ['purchasePlans', '采购计划'],
        ['suppliers', '供应商管理'],
        ['batches', '批次库存'],
        ['expiryAlerts', '临期提醒'],
        ['stockChecks', '库存盘点'],
        ['afterSales', '售后客服'],
        ['withdrawals', '提现管理'],
        ['alerts', '告警中心'],
        ['taxRecords', '税务人工 Review'],
        ['dashboardV2', '经营驾驶舱 V2'],
        ['finance', '财务对账'],
        ['refundLedger', '退款台账'],
        ['rewardLedger', '开团服务奖励'],
        ['operations', '运营看板'],
        ['pickupWorkbench', '自提工作台'],
        ['deliveryReservation', '配送预留'],
        ['deliveryRuleConfig', '管理配送规则'],
      ]);
  });
});
