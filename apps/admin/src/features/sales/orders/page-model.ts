import type { AdminOrderListQuery } from './types';

export type AdminOrderFilters = Omit<
  AdminOrderListQuery,
  'page' | 'page_size'
>;

export const DEFAULT_ADMIN_ORDER_QUERY: AdminOrderListQuery = {
  page: 1,
  page_size: 20,
};

function normalizedFilters(
  filters: AdminOrderFilters,
): AdminOrderFilters {
  return Object.fromEntries(
    Object.entries(filters)
      .map(([key, value]) => [
        key,
        typeof value === 'string' ? value.trim() : value,
      ])
      .filter(([, value]) => value !== undefined && value !== ''),
  ) as AdminOrderFilters;
}

export function applyOrderFilters(
  current: AdminOrderListQuery,
  filters: AdminOrderFilters,
): AdminOrderListQuery {
  return {
    page: 1,
    page_size: current.page_size,
    ...normalizedFilters(filters),
  };
}

export function changeOrderPage(
  current: AdminOrderListQuery,
  page: number,
  pageSize: number,
): AdminOrderListQuery {
  return {
    ...current,
    page,
    page_size: pageSize,
  };
}
