export type DeliveryCommandStatus =
  | 'pending_dispatch'
  | 'delivering'
  | 'delivered'
  | 'exception';

export type DeliveryCommandRow = {
  version: number;
  delivery_status: 'none' | DeliveryCommandStatus;
  allowed_next_statuses: readonly DeliveryCommandStatus[];
};

export function buildDeliveryStatusCommandInput(
  row: DeliveryCommandRow,
  nextStatus: DeliveryCommandStatus,
  remark: string | undefined,
  keyFactory: () => string = () => crypto.randomUUID(),
) {
  if (!row.allowed_next_statuses.includes(nextStatus)) {
    throw new Error(`当前配送状态不可变更为 ${nextStatus}`);
  }
  return {
    delivery_status: nextStatus,
    expected_version: row.version,
    idempotency_key: keyFactory(),
    ...(remark ? { remark } : {}),
  };
}
