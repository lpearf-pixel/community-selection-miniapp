import type { FastifyReply, FastifyRequest } from 'fastify';
import { fail } from '@community-selection/shared';
import { prisma } from '../../db.js';

export type AdminRole = 'super_admin' | 'store_manager' | 'clerk' | 'finance' | 'aftersales' | 'operator';

export type AdminPermission =
  | 'admin.full_access'
  | 'operations.view'
  | 'product.manage'
  | 'order.view'
  | 'order.manage'
  | 'pickup.verify'
  | 'after_sale.manage'
  | 'refund.view'
  | 'refund.manage'
  | 'finance.view'
  | 'finance.export'
  | 'risk.view'
  | 'staff.manage'
  | 'system.manage';

const ALL_PERMISSIONS: AdminPermission[] = [
  'admin.full_access',
  'operations.view',
  'product.manage',
  'order.view',
  'order.manage',
  'pickup.verify',
  'after_sale.manage',
  'refund.view',
  'refund.manage',
  'finance.view',
  'finance.export',
  'risk.view',
  'staff.manage',
  'system.manage'
];

export const ROLE_PERMISSIONS: Record<AdminRole, AdminPermission[]> = {
  super_admin: ALL_PERMISSIONS,
  store_manager: ['operations.view', 'order.view', 'order.manage', 'pickup.verify', 'after_sale.manage', 'product.manage'],
  clerk: ['pickup.verify', 'order.view'],
  finance: ['finance.view', 'finance.export', 'refund.view', 'refund.manage', 'risk.view', 'order.view'],
  aftersales: ['order.view', 'after_sale.manage', 'refund.view'],
  operator: ['operations.view', 'product.manage', 'order.view']
};

export type AdminDataScope = {
  pickup_store_ids: string[];
  community_ids: string[];
  can_access_all_pickup_stores: boolean;
  can_access_all_communities: boolean;
};

export type AdminAccessContext = {
  admin_user_id: string;
  role: AdminRole;
  permissions: AdminPermission[];
  is_super_admin: boolean;
  data_scope: AdminDataScope;
};

const roleValues = new Set<AdminRole>(['super_admin', 'store_manager', 'clerk', 'finance', 'aftersales', 'operator']);

function headerValue(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function headerIds(request: FastifyRequest, singleName: string, multiName: string): string[] {
  const values = [headerValue(request, singleName), headerValue(request, multiName)]
    .flatMap((value) => (value ?? '').split(','))
    .map((value) => value.trim())
    .filter(Boolean);
  return Array.from(new Set(values));
}

export function resolveAdminDataScope(request: FastifyRequest, role: AdminRole): AdminDataScope {
  // Only super_admin has default full data scope. clerk 不默认全量; store_manager 不默认全量.
  if (role === 'super_admin') {
    return { pickup_store_ids: [], community_ids: [], can_access_all_pickup_stores: true, can_access_all_communities: true };
  }
  return {
    pickup_store_ids: headerIds(request, 'x-admin-pickup-store-id', 'x-admin-pickup-store-ids'),
    community_ids: headerIds(request, 'x-admin-community-id', 'x-admin-community-ids'),
    can_access_all_pickup_stores: false,
    can_access_all_communities: false
  };
}

function normalizeAdminRole(value: string | null | undefined, source: 'session' | 'header'): AdminRole | null {
  if (!value) return null;
  if (source === 'session' && value === 'admin') return 'super_admin';
  if (roleValues.has(value as AdminRole)) return value as AdminRole;
  return null; // unknown role rejected
}

function canUseHeaderRole(): boolean {
  // x-admin-role is a dev/mock baseline only; production does not trust x-admin-role.
  return process.env.NODE_ENV !== 'production';
}

export function resolveAdminAccessContext(request: FastifyRequest): AdminAccessContext | null {
  const sessionRole = normalizeAdminRole(request.adminUser?.role, 'session');
  if (request.adminUser?.id && sessionRole) {
    return {
      admin_user_id: request.adminUser.id,
      role: sessionRole,
      permissions: ROLE_PERMISSIONS[sessionRole],
      is_super_admin: sessionRole === 'super_admin',
      data_scope: resolveAdminDataScope(request, sessionRole)
    };
  }

  if (!canUseHeaderRole()) return null;
  const headerRole = normalizeAdminRole(headerValue(request, 'x-admin-role'), 'header');
  const adminUserId = headerValue(request, 'x-admin-user-id');
  if (!headerRole || !adminUserId) return null; // no default super_admin; missing identity is unauthorized

  return {
    admin_user_id: adminUserId,
    role: headerRole,
    permissions: ROLE_PERMISSIONS[headerRole],
    is_super_admin: headerRole === 'super_admin',
    data_scope: resolveAdminDataScope(request, headerRole)
  };
}

export function hasAdminPermission(context: AdminAccessContext, permission: AdminPermission): boolean {
  return context.is_super_admin || context.permissions.includes('admin.full_access') || context.permissions.includes(permission);
}

export function requireAdminPermission(permission: AdminPermission | AdminPermission[]) {
  return async function adminPermissionGuard(request: FastifyRequest, reply: FastifyReply) {
    const context = resolveAdminAccessContext(request);
    if (!context) {
      reply.code(401).send(fail('ADMIN_UNAUTHORIZED: Admin identity required'));
      return;
    }
    const adminUser = await prisma.adminUser.findUnique({ where: { id: context.admin_user_id }, select: { status: true } });
    if (!adminUser || adminUser.status !== 'active') {
      reply.code(401).send(fail('ADMIN_UNAUTHORIZED: Active AdminUser required'));
      return;
    }
    const required = Array.isArray(permission) ? permission : [permission];
    if (!required.some((item) => hasAdminPermission(context, item))) {
      reply.code(403).send(fail('ADMIN_FORBIDDEN: Permission denied'));
      return;
    }
  };
}


export const ADMIN_SCOPE_FORBIDDEN = 'ADMIN_SCOPE_FORBIDDEN: Data scope denied';

export function hasAllPickupStoreScope(context: AdminAccessContext): boolean {
  return context.data_scope.can_access_all_pickup_stores;
}

export function hasAllCommunityScope(context: AdminAccessContext): boolean {
  return context.data_scope.can_access_all_communities;
}

export function canAccessPickupStore(context: AdminAccessContext, pickupStoreId?: string | null): boolean {
  if (hasAllPickupStoreScope(context)) return true;
  return !!pickupStoreId && context.data_scope.pickup_store_ids.includes(pickupStoreId);
}

export function canAccessCommunity(context: AdminAccessContext, communityId?: string | null): boolean {
  if (hasAllCommunityScope(context)) return true;
  return !!communityId && context.data_scope.community_ids.includes(communityId);
}

export function canAccessOrderDataScope(context: AdminAccessContext, order: { pickup_store_id?: string | null; community_id?: string | null }): boolean {
  const pickupAllowed = canAccessPickupStore(context, order.pickup_store_id);
  const communityAllowed = canAccessCommunity(context, order.community_id);
  return pickupAllowed || communityAllowed;
}

export function getScopedPickupStoreWhere(context: AdminAccessContext): Record<string, unknown> | null {
  if (hasAllPickupStoreScope(context)) return {};
  if (context.data_scope.pickup_store_ids.length === 0) return null;
  return { pickup_store_id: { in: context.data_scope.pickup_store_ids } };
}

export function getScopedCommunityWhere(context: AdminAccessContext): Record<string, unknown> | null {
  if (hasAllCommunityScope(context)) return {};
  if (context.data_scope.community_ids.length === 0) return null;
  return { community_id: { in: context.data_scope.community_ids } };
}

export function getScopedOrderWhere(context: AdminAccessContext): Record<string, unknown> | null {
  const or: Record<string, unknown>[] = [];
  if (hasAllPickupStoreScope(context) || hasAllCommunityScope(context)) return {};
  if (context.data_scope.pickup_store_ids.length > 0) or.push({ pickup_store_id: { in: context.data_scope.pickup_store_ids } });
  if (context.data_scope.community_ids.length > 0) or.push({ community_id: { in: context.data_scope.community_ids } });
  return or.length > 0 ? { OR: or } : null;
}

export function requireAdminDataScopeForPickupStore(context: AdminAccessContext, pickupStoreId?: string | null): void {
  if (!canAccessPickupStore(context, pickupStoreId)) throw Object.assign(new Error(ADMIN_SCOPE_FORBIDDEN), { statusCode: 403 });
}

export function requireAdminDataScopeForCommunity(context: AdminAccessContext, communityId?: string | null): void {
  if (!canAccessCommunity(context, communityId)) throw Object.assign(new Error(ADMIN_SCOPE_FORBIDDEN), { statusCode: 403 });
}
