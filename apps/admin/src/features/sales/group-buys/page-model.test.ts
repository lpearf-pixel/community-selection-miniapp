import { expect, it } from 'vitest';

import {
  replaceClosureWorkbench,
  resolveClosureWorkbenchRequest,
  selectClosureGroupBuy,
  type ClosureWorkbenchRequestToken,
  type ClosureWorkbenchState,
} from './page-model';

it('keeps closure selection while the primary list refreshes', () => {
  const state = {
    selectedGroupBuyId: 'g1',
    closureSummary: { group_buy_id: 'g1' },
    manualRefundOrders: [{ order_id: 'o1' }],
  } as ClosureWorkbenchState;

  expect(selectClosureGroupBuy(state, 'g2')).toEqual({
    selectedGroupBuyId: 'g2',
    closureSummary: null,
    manualRefundOrders: [],
  });
  expect(
    replaceClosureWorkbench(state, {
      summary: { group_buy_id: 'g1' },
      refundOrders: [{ order_id: 'o2' }],
    } as Parameters<typeof replaceClosureWorkbench>[1]).selectedGroupBuyId,
  ).toBe('g1');
});

it('ignores a closure response for an older different selection', () => {
  const state = {
    selectedGroupBuyId: 'g2',
    closureSummary: null,
    manualRefundOrders: [],
  } as ClosureWorkbenchState;
  const request = {
    generation: 1,
    groupBuyId: 'g1',
  } satisfies ClosureWorkbenchRequestToken;

  expect(
    resolveClosureWorkbenchRequest(
      state,
      {
        summary: { group_buy_id: 'g1' },
        refundOrders: [{ order_id: 'o1' }],
      } as Parameters<typeof replaceClosureWorkbench>[1],
      request,
      1,
    ),
  ).toBe(state);
});

it('ignores an older closure response for a repeated load of the same selection', () => {
  const state = {
    selectedGroupBuyId: 'g1',
    closureSummary: { group_buy_id: 'g1', status: 'newer' },
    manualRefundOrders: [{ order_id: 'newer' }],
  } as ClosureWorkbenchState;
  const request = {
    generation: 1,
    groupBuyId: 'g1',
  } satisfies ClosureWorkbenchRequestToken;

  expect(
    resolveClosureWorkbenchRequest(
      state,
      {
        summary: { group_buy_id: 'g1', status: 'older' },
        refundOrders: [{ order_id: 'older' }],
      } as Parameters<typeof replaceClosureWorkbench>[1],
      request,
      2,
    ),
  ).toBe(state);
});
