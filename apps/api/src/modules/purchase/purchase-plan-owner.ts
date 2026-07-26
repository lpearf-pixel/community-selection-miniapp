import type { Prisma } from '@prisma/client';
import type {
  AdminPurchaseReceiveCommand,
  AdminPurchaseReceiveItem,
} from './admin-purchase-receive-command.js';

export type LockedPurchasePlan = {
  id: string;
  plan_no: string;
  status: string;
  items: Array<{
    id: string;
    product_id: string;
    product_name_snapshot: string;
    planned_quantity: number;
    received_quantity: number;
    purchase_quantity: number | null;
    purchase_unit: string | null;
    stock_in_quantity: number | null;
    cost_price_cents: number;
  }>;
};

export type ValidatedReceiptItem = Omit<
  AdminPurchaseReceiveItem,
  'arrival_date' | 'production_date'
> & {
  product_id: string;
  product_name_snapshot: string;
  purchase_quantity: number | null;
  purchase_unit: string | null;
  stock_in_quantity: number | null;
  cost_price_cents: number;
  arrival_date: Date;
  production_date: Date | null;
  expire_at: Date | null;
};

export type PurchaseReceiptValidation =
  | { ok: true; value: ValidatedReceiptItem[] }
  | { ok: false; message: string };

export async function lockPurchasePlan(
  tx: Prisma.TransactionClient,
  purchasePlanId: string,
): Promise<LockedPurchasePlan> {
  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM "PurchasePlan"
    WHERE id = ${purchasePlanId}
    FOR UPDATE
  `;
  const current = await tx.purchasePlan.findUnique({
    where: { id: purchasePlanId },
    include: { items: true },
  });
  if (!current) throw new Error('采购计划不存在');
  return current;
}

export function validatePurchaseReceipt(
  lockedPlan: LockedPurchasePlan,
  command: AdminPurchaseReceiveCommand,
): PurchaseReceiptValidation {
  if (!['confirmed', 'ordered'].includes(lockedPlan.status)) {
    return {
      ok: false,
      message: '仅已确认或已下单采购计划可入库',
    };
  }
  const itemMap = new Map(lockedPlan.items.map((item) => [item.id, item]));
  const validated: ValidatedReceiptItem[] = [];
  for (const receivedItem of command.items) {
    const item = itemMap.get(receivedItem.item_id);
    if (!item) return { ok: false, message: '入库明细不存在' };
    if (
      item.received_quantity + receivedItem.received_quantity >
      item.planned_quantity
    ) {
      return { ok: false, message: '累计入库数量不能超过计划数量' };
    }
    const arrivalDate = receivedItem.arrival_date
      ? new Date(receivedItem.arrival_date)
      : new Date();
    if (Number.isNaN(arrivalDate.getTime())) {
      return { ok: false, message: '到货日期不合法' };
    }
    const productionDate = receivedItem.production_date
      ? new Date(receivedItem.production_date)
      : null;
    if (productionDate && Number.isNaN(productionDate.getTime())) {
      return { ok: false, message: '生产日期不合法' };
    }
    const expireAt = receivedItem.shelf_life_days
      ? new Date(
          arrivalDate.getTime() +
            receivedItem.shelf_life_days * 24 * 60 * 60 * 1000,
        )
      : null;
    validated.push({
      ...receivedItem,
      product_id: item.product_id,
      product_name_snapshot: item.product_name_snapshot,
      purchase_quantity: item.purchase_quantity,
      purchase_unit: item.purchase_unit,
      stock_in_quantity: item.stock_in_quantity,
      cost_price_cents: item.cost_price_cents,
      arrival_date: arrivalDate,
      production_date: productionDate,
      expire_at: expireAt,
    });
  }
  return { ok: true, value: validated };
}

export async function applyPurchaseReceipt(
  tx: Prisma.TransactionClient,
  input: {
    purchase_plan_id: string;
    items: Array<{ item_id: string; received_quantity: number }>;
  },
): Promise<LockedPurchasePlan> {
  for (const item of input.items) {
    if (item.received_quantity <= 0) continue;
    await tx.purchasePlanItem.update({
      where: { id: item.item_id },
      data: { received_quantity: { increment: item.received_quantity } },
    });
  }
  const current = await tx.purchasePlan.findUnique({
    where: { id: input.purchase_plan_id },
    include: { items: true },
  });
  if (!current) throw new Error('采购计划不存在');
  const status = current.items.every(
    (item) => item.received_quantity >= item.planned_quantity,
  )
    ? 'received'
    : 'ordered';
  return tx.purchasePlan.update({
    where: { id: input.purchase_plan_id },
    data: { status },
    include: { items: true },
  });
}

export async function transitionPurchasePlan(
  tx: Prisma.TransactionClient,
  input: {
    purchase_plan_id: string;
    action: 'confirm' | 'cancel';
  },
): Promise<LockedPurchasePlan> {
  const current = await lockPurchasePlan(tx, input.purchase_plan_id);
  if (input.action === 'confirm' && current.status !== 'draft') {
    throw new Error('仅草稿采购计划可确认');
  }
  if (
    input.action === 'cancel' &&
    !['draft', 'confirmed'].includes(current.status)
  ) {
    throw new Error('当前采购计划不可取消');
  }
  return tx.purchasePlan.update({
    where: { id: input.purchase_plan_id },
    data: { status: input.action === 'confirm' ? 'confirmed' : 'cancelled' },
    include: { items: true },
  });
}
