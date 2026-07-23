import type {
  ClosureSummary,
  ClosureWorkbenchData,
  ManualRefundOrder,
} from './types';

export type ClosureWorkbenchState = {
  selectedGroupBuyId: string | null;
  closureSummary: ClosureSummary | null;
  manualRefundOrders: ManualRefundOrder[];
};

export type ClosureWorkbenchRequestToken = {
  generation: number;
  groupBuyId: string;
};

export function selectClosureGroupBuy(
  state: ClosureWorkbenchState,
  selectedGroupBuyId: string,
): ClosureWorkbenchState {
  return {
    ...state,
    selectedGroupBuyId,
    closureSummary: null,
    manualRefundOrders: [],
  };
}

export function replaceClosureWorkbench(
  state: ClosureWorkbenchState,
  workbench: ClosureWorkbenchData,
): ClosureWorkbenchState {
  return {
    ...state,
    closureSummary: workbench.summary,
    manualRefundOrders: workbench.refundOrders,
  };
}

export function resolveClosureWorkbenchRequest(
  state: ClosureWorkbenchState,
  workbench: ClosureWorkbenchData,
  request: ClosureWorkbenchRequestToken,
  currentGeneration: number,
): ClosureWorkbenchState {
  if (
    request.generation !== currentGeneration ||
    state.selectedGroupBuyId !== request.groupBuyId
  ) {
    return state;
  }
  return replaceClosureWorkbench(state, workbench);
}
