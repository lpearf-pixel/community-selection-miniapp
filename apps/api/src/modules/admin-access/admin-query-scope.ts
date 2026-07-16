import type { Prisma } from '@prisma/client';
import type { DashboardQueryContext } from '../dashboard-v2/dashboard-v2-query.js';

export function buildScopedOrderWhere(context: DashboardQueryContext): Prisma.OrderWhereInput {
  const { scope } = context;
  if (scope.isSuperAdmin) return { ...(scope.communityIds.length ? { community_id: scope.communityIds[0] } : {}), ...(scope.pickupStoreIds.length ? { pickup_store_id: scope.pickupStoreIds[0] } : {}) };
  const allowed: Prisma.OrderWhereInput[] = [];
  if (scope.communityIds.length) allowed.push({ community_id: { in: scope.communityIds } });
  if (scope.pickupStoreIds.length) allowed.push({ pickup_store_id: { in: scope.pickupStoreIds } });
  return allowed.length ? { OR: allowed } : { id: { in: [] } };
}

export function buildScopedWithdrawalWhere(context: DashboardQueryContext): Prisma.WithdrawalWhereInput {
  if (!context.scope.isSuperAdmin && !context.scope.communityIds.length && !context.scope.pickupStoreIds.length) return { id: { in: [] } };
  const order = buildScopedOrderWhere(context);
  return context.scope.isSuperAdmin && !context.scope.communityIds.length && !context.scope.pickupStoreIds.length ? {} : { commission_links: { some: {}, every: { commission: { order } } } };
}

export function buildScopedGroupBuyWhere(context: DashboardQueryContext): Prisma.GroupBuyWhereInput {
  const { scope } = context;
  if (!scope.isSuperAdmin && !scope.communityIds.length && !scope.pickupStoreIds.length) return { id: { in: [] } };
  if (scope.isSuperAdmin && !scope.communityIds.length && !scope.pickupStoreIds.length) return {};
  const allowed: Prisma.GroupBuyWhereInput[] = [];
  if (scope.communityIds.length) allowed.push({ community_id: { in: scope.communityIds } });
  if (scope.pickupStoreIds.length) allowed.push({ orders: { some: { pickup_store_id: { in: scope.pickupStoreIds } } } });
  return { OR: allowed };
}

export function buildScopedProductWhere(context: DashboardQueryContext): Prisma.ProductWhereInput {
  if (context.scope.isSuperAdmin && !context.scope.communityIds.length && !context.scope.pickupStoreIds.length) return {};
  return { group_buys: { some: buildScopedGroupBuyWhere(context) } };
}

export function buildScopedProductBatchWhere(context: DashboardQueryContext): Prisma.ProductBatchWhereInput {
  if (context.scope.isSuperAdmin && !context.scope.communityIds.length && !context.scope.pickupStoreIds.length) return {};
  return { product: buildScopedProductWhere(context) };
}
