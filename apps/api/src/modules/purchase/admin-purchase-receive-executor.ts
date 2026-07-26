import { Prisma } from '@prisma/client';
import { prisma } from '../../db.js';
import { recordAdminAudit } from '../audit/audit-service.js';
import {
  createPurchaseBatch,
  loadPurchaseSupplierSnapshots,
} from '../inventory/purchase-batch-owner.js';
import { receivePurchaseInventory } from '../inventory/purchase-inventory-owner.js';
import {
  type AdminPurchaseReceiveCommand,
  type AdminPurchaseReceiveResult,
  buildAdminPurchaseReceiveRequestHash,
  isAdminPurchaseReceiveResult,
} from './admin-purchase-receive-command.js';
import {
  applyPurchaseReceipt,
  lockPurchasePlan,
  validatePurchaseReceipt,
} from './purchase-plan-owner.js';

const OPERATION = 'admin.purchase-plan.receive.v1';
const SUCCESS_CODE = 'ADMIN_PURCHASE_PLAN_RECEIVED';

export class AdminPurchaseReceiveCommandError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code:
      | 'ADMIN_PURCHASE_PLAN_NOT_FOUND'
      | 'ADMIN_IDEMPOTENCY_KEY_REUSED'
      | 'ADMIN_PURCHASE_RECEIVE_CONFLICT'
      | 'ADMIN_PURCHASE_RECEIVE_INVALID'
      | 'ADMIN_PURCHASE_RECEIVE_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'AdminPurchaseReceiveCommandError';
  }
}

function commandError(
  statusCode: number,
  code: AdminPurchaseReceiveCommandError['code'],
  message: string,
) {
  return new AdminPurchaseReceiveCommandError(statusCode, code, message);
}

function isUniqueConflict(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

function isTransactionConflict(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2034'
  );
}

function mapDomainError(error: unknown): never {
  if (error instanceof AdminPurchaseReceiveCommandError) throw error;
  if (isTransactionConflict(error)) {
    throw commandError(
      409,
      'ADMIN_PURCHASE_RECEIVE_CONFLICT',
      '采购计划已变化，请刷新后重试',
    );
  }
  if (error instanceof Error) {
    if (error.message === '采购计划不存在') {
      throw commandError(
        404,
        'ADMIN_PURCHASE_PLAN_NOT_FOUND',
        error.message,
      );
    }
    if (
      [
        '仅已确认或已下单采购计划可入库',
        '入库明细不存在',
        '累计入库数量不能超过计划数量',
        '供应商不存在',
        '到货日期不合法',
        '生产日期不合法',
        '保质期天数必须大于 0',
        '入库商品不存在',
        '入库数量不合法',
      ].includes(error.message)
    ) {
      throw commandError(
        400,
        'ADMIN_PURCHASE_RECEIVE_INVALID',
        error.message,
      );
    }
  }
  throw commandError(
    500,
    'ADMIN_PURCHASE_RECEIVE_FAILED',
    '采购入库失败',
  );
}

export async function executeAdminPurchaseReceiveCommand(input: {
  purchase_plan_id: string;
  command: AdminPurchaseReceiveCommand;
  context: { admin_user_id: string };
  admin_meta: {
    ip_address?: string | null;
    user_agent?: string | null;
  };
}): Promise<AdminPurchaseReceiveResult> {
  const requestHash = buildAdminPurchaseReceiveRequestHash({
    purchase_plan_id: input.purchase_plan_id,
    command: input.command,
  });
  const receiptKey = {
    admin_user_id: input.context.admin_user_id,
    idempotency_key: input.command.idempotency_key,
  };

  const replay = async (): Promise<AdminPurchaseReceiveResult> => {
    const receipt = await prisma.adminCommandReceipt.findUnique({
      where: { admin_user_id_idempotency_key: receiptKey },
    });
    if (!receipt) {
      throw commandError(
        500,
        'ADMIN_PURCHASE_RECEIVE_FAILED',
        '采购入库失败',
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
      receipt.target_id !== input.purchase_plan_id ||
      receipt.completed_at === null ||
      receipt.response_http_status !== 200 ||
      receipt.response_code !== SUCCESS_CODE ||
      !isAdminPurchaseReceiveResult(
        receipt.response_data,
        input.purchase_plan_id,
      )
    ) {
      throw commandError(
        500,
        'ADMIN_PURCHASE_RECEIVE_FAILED',
        '采购入库失败',
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
          target_id: input.purchase_plan_id,
          request_hash: requestHash,
        },
      });
      const lockedPlan = await lockPurchasePlan(tx, input.purchase_plan_id);
      const validation = validatePurchaseReceipt(
        lockedPlan,
        input.command,
      );
      if (!validation.ok) throw new Error(validation.message);
      const suppliers = await loadPurchaseSupplierSnapshots(
        tx,
        validation.value,
      );
      const positiveItems = validation.value
        .filter((item) => item.received_quantity > 0)
        .sort(
          (left, right) =>
            left.product_id.localeCompare(right.product_id) ||
            left.item_id.localeCompare(right.item_id),
        );
      const effects: Array<{
        item_id: string;
        received_quantity: number;
        batch_id: string;
        batch_no: string;
        batch_ledger_id: string;
        stock_ledger_id: string;
      }> = [];
      for (const item of positiveItems) {
        const inventory = await receivePurchaseInventory(tx, {
          receipt_id: receipt.id,
          purchase_plan_id: lockedPlan.id,
          purchase_plan_item_id: item.item_id,
          product_id: item.product_id,
          received_quantity: item.received_quantity,
          admin_user_id: input.context.admin_user_id,
          remark: input.command.remark ?? null,
          payload: {
            purchase_unit: item.purchase_unit,
            purchase_quantity: item.purchase_quantity,
            stock_in_quantity: item.stock_in_quantity,
          },
        });
        const batch = await createPurchaseBatch(tx, {
          purchase_plan_id: lockedPlan.id,
          item,
          supplier: item.supplier_id
            ? suppliers.get(item.supplier_id) ?? null
            : null,
          inventory,
          admin_user_id: input.context.admin_user_id,
          command_remark: input.command.remark ?? null,
        });
        if (!batch) {
          throw new Error('采购入库失败');
        }
        effects.push({
          item_id: item.item_id,
          received_quantity: item.received_quantity,
          stock_ledger_id: inventory.stock_ledger_id,
          ...batch,
        });
      }
      const updated = await applyPurchaseReceipt(tx, {
        purchase_plan_id: lockedPlan.id,
        items: validation.value.map((item) => ({
          item_id: item.item_id,
          received_quantity: item.received_quantity,
        })),
      });
      for (const effect of effects) {
        await recordAdminAudit(tx, {
          admin_user_id: input.context.admin_user_id,
          action: 'purchase_batch_created',
          target_type: 'ProductBatch',
          target_id: effect.batch_id,
          ip_address: input.admin_meta.ip_address ?? null,
          user_agent: input.admin_meta.user_agent ?? null,
          payload: {
            idempotency_key: input.command.idempotency_key,
            receipt_id: receipt.id,
            purchase_plan_id: lockedPlan.id,
            item_id: effect.item_id,
            received_quantity: effect.received_quantity,
            batch_id: effect.batch_id,
            batch_ledger_id: effect.batch_ledger_id,
            stock_ledger_id: effect.stock_ledger_id,
          },
        });
      }
      await recordAdminAudit(tx, {
        admin_user_id: input.context.admin_user_id,
        action: 'purchase_plan_received',
        target_type: 'PurchasePlan',
        target_id: lockedPlan.id,
        ip_address: input.admin_meta.ip_address ?? null,
        user_agent: input.admin_meta.user_agent ?? null,
        payload: {
          idempotency_key: input.command.idempotency_key,
          receipt_id: receipt.id,
          items: effects,
        },
      });
      const result = JSON.parse(
        JSON.stringify(updated),
      ) as AdminPurchaseReceiveResult;
      if (!isAdminPurchaseReceiveResult(result, lockedPlan.id)) {
        throw new Error('采购入库失败');
      }
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
    if (isUniqueConflict(error)) return replay();
    return mapDomainError(error);
  }
}
