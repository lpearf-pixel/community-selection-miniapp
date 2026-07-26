import { createHash } from 'node:crypto';

const OPERATION = 'admin.purchase-plan.receive.v1';
const INVALID_MESSAGE = '采购入库命令不合法';
const IDEMPOTENCY_KEY = /^[\x20-\x7e]{16,128}$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const ROOT_KEYS = new Set(['idempotency_key', 'remark', 'items']);
const ITEM_KEYS = new Set([
  'item_id',
  'received_quantity',
  'supplier_id',
  'production_date',
  'arrival_date',
  'shelf_life_days',
  'remark',
]);

export type AdminPurchaseReceiveItem = {
  item_id: string;
  received_quantity: number;
  supplier_id?: string;
  production_date?: string;
  arrival_date?: string;
  shelf_life_days?: number;
  remark?: string;
};

export type AdminPurchaseReceiveCommand = {
  idempotency_key: string;
  remark?: string;
  items: AdminPurchaseReceiveItem[];
};

export type AdminPurchaseReceiveResult = {
  id: string;
  plan_no: string;
  status: string;
  items: Array<{
    id: string;
    product_id: string;
    planned_quantity: number;
    received_quantity: number;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
};

export type AdminPurchaseReceiveCommandParseResult =
  | { ok: true; value: AdminPurchaseReceiveCommand }
  | {
      ok: false;
      code: 'INVALID_ADMIN_PURCHASE_RECEIVE_COMMAND';
      message: string;
    };

function invalidCommand(): AdminPurchaseReceiveCommandParseResult {
  return {
    ok: false,
    code: 'INVALID_ADMIN_PURCHASE_RECEIVE_COMMAND',
    message: INVALID_MESSAGE,
  };
}

function optionalText(
  value: unknown,
  options: { max: number; empty?: boolean } = { max: 500 },
): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || CONTROL_CHARACTER.test(value)) return null;
  const normalized = value.trim();
  if ((!options.empty && normalized.length === 0) || normalized.length > options.max) {
    return null;
  }
  return normalized || undefined;
}

function optionalDate(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0 || Number.isNaN(Date.parse(value))) {
    return null;
  }
  return value;
}

export function parseAdminPurchaseReceiveCommand(
  input: unknown,
): AdminPurchaseReceiveCommandParseResult {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return invalidCommand();
  }
  const body = input as Record<string, unknown>;
  if (
    Object.keys(body).some((key) => !ROOT_KEYS.has(key)) ||
    typeof body.idempotency_key !== 'string' ||
    body.idempotency_key !== body.idempotency_key.trim() ||
    !IDEMPOTENCY_KEY.test(body.idempotency_key) ||
    !Array.isArray(body.items) ||
    body.items.length === 0
  ) {
    return invalidCommand();
  }

  const remark = optionalText(body.remark, { max: 500, empty: true });
  if (remark === null) return invalidCommand();

  const itemIds = new Set<string>();
  const items: AdminPurchaseReceiveItem[] = [];
  for (const candidate of body.items) {
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return invalidCommand();
    }
    const item = candidate as Record<string, unknown>;
    if (
      Object.keys(item).some((key) => !ITEM_KEYS.has(key)) ||
      typeof item.item_id !== 'string' ||
      item.item_id.trim() !== item.item_id ||
      item.item_id.length === 0 ||
      item.item_id.length > 128 ||
      CONTROL_CHARACTER.test(item.item_id) ||
      itemIds.has(item.item_id) ||
      !Number.isSafeInteger(item.received_quantity) ||
      Number(item.received_quantity) < 0
    ) {
      return invalidCommand();
    }
    const supplierId = optionalText(item.supplier_id, { max: 128 });
    const productionDate = optionalDate(item.production_date);
    const arrivalDate = optionalDate(item.arrival_date);
    const itemRemark = optionalText(item.remark, { max: 500, empty: true });
    if (
      supplierId === null ||
      productionDate === null ||
      arrivalDate === null ||
      itemRemark === null ||
      (item.shelf_life_days !== undefined &&
        (!Number.isSafeInteger(item.shelf_life_days) ||
          Number(item.shelf_life_days) <= 0))
    ) {
      return invalidCommand();
    }
    itemIds.add(item.item_id);
    items.push({
      item_id: item.item_id,
      received_quantity: Number(item.received_quantity),
      supplier_id: supplierId,
      production_date: productionDate,
      arrival_date: arrivalDate,
      shelf_life_days:
        item.shelf_life_days === undefined
          ? undefined
          : Number(item.shelf_life_days),
      remark: itemRemark,
    });
  }

  return {
    ok: true,
    value: {
      idempotency_key: body.idempotency_key,
      remark,
      items,
    },
  };
}

export function buildAdminPurchaseReceiveRequestHash(input: {
  purchase_plan_id: string;
  command: AdminPurchaseReceiveCommand;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        operation: OPERATION,
        purchase_plan_id: input.purchase_plan_id,
        remark: input.command.remark,
        items: input.command.items,
      }),
    )
    .digest('hex');
}

export function isAdminPurchaseReceiveResult(
  value: unknown,
  purchasePlanId: string,
): value is AdminPurchaseReceiveResult {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const result = value as Record<string, unknown>;
  return (
    result.id === purchasePlanId &&
    typeof result.plan_no === 'string' &&
    result.plan_no.length > 0 &&
    typeof result.status === 'string' &&
    Array.isArray(result.items) &&
    result.items.every((candidate) => {
      if (
        candidate === null ||
        typeof candidate !== 'object' ||
        Array.isArray(candidate)
      ) {
        return false;
      }
      const item = candidate as Record<string, unknown>;
      return (
        typeof item.id === 'string' &&
        typeof item.product_id === 'string' &&
        Number.isSafeInteger(item.planned_quantity) &&
        Number.isSafeInteger(item.received_quantity)
      );
    })
  );
}
