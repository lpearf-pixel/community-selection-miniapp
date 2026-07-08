import type { FastifyReply, FastifyRequest } from 'fastify';
import { fail } from '@community-selection/shared';

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

export type AdminAccessContext = {
  admin_user_id: string;
  role: AdminRole;
  permissions: AdminPermission[];
  is_super_admin: boolean;
};

const roleValues = new Set<AdminRole>(['super_admin', 'store_manager', 'clerk', 'finance', 'aftersales', 'operator']);

function headerValue(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
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
      is_super_admin: sessionRole === 'super_admin'
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
    is_super_admin: headerRole === 'super_admin'
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
    const required = Array.isArray(permission) ? permission : [permission];
    if (!required.some((item) => hasAdminPermission(context, item))) {
      reply.code(403).send(fail('ADMIN_FORBIDDEN: Permission denied'));
      return;
    }
  };
}
