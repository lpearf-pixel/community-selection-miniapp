import { Prisma } from '@prisma/client';
import { prisma } from '../../db.js';
import type { AdminAccessContext } from '../admin-access/admin-access-control.js';
import {
  recordAdminAudit,
  recordBusinessEvent,
} from '../audit/audit-service.js';
import {
  type AdminInventoryAdjustCommand,
  type AdminInventoryAdjustResult,
  buildAdminInventoryAdjustRequestHash,
} from './admin-inventory-adjust-command.js';

const OPERATION = 'admin.inventory.product.adjust.v1';
const SUCCESS_CODE = 'ADMIN_INVENTORY_ADJUSTED';

export class AdminInventoryAdjustCommandError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code:
      | 'ADMIN_INVENTORY_PRODUCT_NOT_FOUND'
      | 'ADMIN_IDEMPOTENCY_KEY_REUSED'
      | 'ADMIN_INVENTORY_STOCK_CONFLICT'
      | 'ADMIN_INVENTORY_ADJUST_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'AdminInventoryAdjustCommandError';
  }
}

function commandError(
  statusCode: number,
  code: AdminInventoryAdjustCommandError['code'],
  message: string,
) {
  return new AdminInventoryAdjustCommandError(statusCode, code, message);
}

export function isAdminInventoryAdjustResult(
  value: unknown,
): value is AdminInventoryAdjustResult {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    typeof item.product_id === 'string' &&
    item.product_id.length > 0 &&
    Number.isSafeInteger(item.stock_before) &&
    Number.isSafeInteger(item.stock_after) &&
    Number.isSafeInteger(item.adjust_quantity) &&
    Number(item.stock_before) + Number(item.adjust_quantity) ===
      Number(item.stock_after) &&
    typeof item.stock_unit === 'string' &&
    item.stock_unit.length > 0
  );
}

function isUniqueConflict(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

export async function executeAdminInventoryAdjustCommand(input: {
  product_id: string;
  command: AdminInventoryAdjustCommand;
  context: AdminAccessContext;
  admin_meta: {
    ip_address?: string | null;
    user_agent?: string | null;
  };
}): Promise<AdminInventoryAdjustResult> {
  const requestHash = buildAdminInventoryAdjustRequestHash({
    product_id: input.product_id,
    expected_stock: input.command.expected_stock,
    adjust_quantity: input.command.adjust_quantity,
    reason: input.command.reason,
  });
  const receiptKey = {
    admin_user_id: input.context.admin_user_id,
    idempotency_key: input.command.idempotency_key,
  };

  const replay = async () => {
    const receipt = await prisma.adminCommandReceipt.findUnique({
      where: { admin_user_id_idempotency_key: receiptKey },
    });
    if (!receipt) {
      throw commandError(
        500,
        'ADMIN_INVENTORY_ADJUST_FAILED',
        '库存调整失败',
      );
    }
    if (receipt.request_hash !== requestHash) {
      throw commandError(
        409,
        'ADMIN_IDEMPOTENCY_KEY_REUSED',
        '幂等键已被其他命令使用',
      );
    }
    if (
      receipt.operation !== OPERATION ||
      receipt.target_id !== input.product_id ||
      receipt.completed_at === null ||
      receipt.response_http_status !== 200 ||
      receipt.response_code !== SUCCESS_CODE ||
      !isAdminInventoryAdjustResult(receipt.response_data) ||
      receipt.response_data.product_id !== input.product_id ||
      receipt.response_data.stock_before !== input.command.expected_stock ||
      receipt.response_data.adjust_quantity !== input.command.adjust_quantity
    ) {
      throw commandError(
        500,
        'ADMIN_INVENTORY_ADJUST_FAILED',
        '库存调整失败',
      );
    }
    return receipt.response_data;
  };

  const existingReceipt = await prisma.adminCommandReceipt.findUnique({
    where: { admin_user_id_idempotency_key: receiptKey },
    select: { id: true },
  });
  if (existingReceipt) return replay();

  try {
    return await prisma.$transaction(async (tx) => {
      const receipt = await tx.adminCommandReceipt.create({
        data: {
          ...receiptKey,
          operation: OPERATION,
          target_id: input.product_id,
          request_hash: requestHash,
        },
      });
      const before = await tx.product.findUnique({
        where: { id: input.product_id },
      });
      if (!before) {
        throw commandError(
          404,
          'ADMIN_INVENTORY_PRODUCT_NOT_FOUND',
          '商品不存在',
        );
      }
      if (before.stock !== input.command.expected_stock) {
        throw commandError(
          409,
          'ADMIN_INVENTORY_STOCK_CONFLICT',
          '库存已变化，请刷新后重试',
        );
      }

      const changed = await tx.product.updateMany({
        where: {
          id: input.product_id,
          stock: input.command.expected_stock,
        },
        data: {
          stock: { increment: input.command.adjust_quantity },
        },
      });
      if (changed.count !== 1) {
        throw commandError(
          409,
          'ADMIN_INVENTORY_STOCK_CONFLICT',
          '库存已变化，请刷新后重试',
        );
      }
      const after = await tx.product.findUniqueOrThrow({
        where: { id: input.product_id },
      });
      const result: AdminInventoryAdjustResult = {
        product_id: after.id,
        stock_before: before.stock,
        stock_after: after.stock,
        adjust_quantity: input.command.adjust_quantity,
        stock_unit: after.stock_unit,
      };

      await tx.stockLedger.create({
        data: {
          product_id: after.id,
          source_type: 'manual_adjust',
          source_id: receipt.id,
          idempotency_key: `inventory-manual-adjust:${receipt.id}`,
          event_type: 'manual_adjust',
          quantity_delta: input.command.adjust_quantity,
          direction: input.command.adjust_quantity > 0 ? 'in' : 'out',
          quantity: Math.abs(input.command.adjust_quantity),
          stock_before: result.stock_before,
          stock_after: result.stock_after,
          operator_type: 'admin',
          operator_id: input.context.admin_user_id,
          remark: input.command.reason,
          payload: {
            stock_unit: after.stock_unit,
            sale_unit: after.sale_unit,
            sale_spec_name: after.sale_spec_name,
            stock_deduct_quantity: after.stock_deduct_quantity,
          },
        },
      });
      await recordBusinessEvent(tx, {
        event_type: 'inventory_manual_adjusted',
        event_source: 'admin-inventory-adjust-command',
        idempotency_key: input.command.idempotency_key,
        before_snapshot: {
          product_id: after.id,
          stock: result.stock_before,
          stock_unit: after.stock_unit,
        },
        after_snapshot: {
          product_id: after.id,
          stock: result.stock_after,
          stock_unit: after.stock_unit,
        },
        payload: result,
      });
      await recordAdminAudit(tx, {
        admin_user_id: input.context.admin_user_id,
        action: 'inventory_manual_adjusted',
        target_type: 'Product',
        target_id: after.id,
        ip_address: input.admin_meta.ip_address ?? null,
        user_agent: input.admin_meta.user_agent ?? null,
        payload: {
          idempotency_key: input.command.idempotency_key,
          reason: input.command.reason,
          stock_before: result.stock_before,
          stock_after: result.stock_after,
          adjust_quantity: result.adjust_quantity,
          stock_unit: result.stock_unit,
        },
      });
      await tx.adminCommandReceipt.update({
        where: { id: receipt.id },
        data: {
          response_http_status: 200,
          response_code: SUCCESS_CODE,
          response_data: result as Prisma.InputJsonValue,
          completed_at: new Date(),
        },
      });
      return result;
    });
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    return replay();
  }
}
