import { useRef, useState } from 'react';
import { AdminApiError } from '../../../shared/api/errors';
import { executeAfterSaleRefund } from './api';
import type { AfterSaleCase } from './types';

type RefundExecutionOptions = {
  onSuccess: () => void;
  onConflictRefresh: () => void;
};

export function canExecuteApprovedRefund(afterSale: AfterSaleCase): boolean {
  return (
    afterSale.status === 'approved' &&
    (afterSale.resolution_type === 'refund' ||
      afterSale.resolution_type === 'partial_refund') &&
    (afterSale.approved_refund_cents ?? 0) > 0 &&
    Number.isInteger(afterSale.order?.version)
  );
}

export function useRefundExecution(options: RefundExecutionOptions) {
  const attemptKeys = useRef(new Map<string, string>());
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const execute = async (afterSale: AfterSaleCase, adminRemark: string) => {
    const expectedVersion = afterSale.order?.version;
    if (!canExecuteApprovedRefund(afterSale) || expectedVersion === undefined) {
      throw new Error('当前售后单不可执行退款');
    }

    const idempotencyKey =
      attemptKeys.current.get(afterSale.id) ??
      `admin-refund-${crypto.randomUUID()}`;
    attemptKeys.current.set(afterSale.id, idempotencyKey);
    setPendingIds((current) => new Set(current).add(afterSale.id));

    try {
      await executeAfterSaleRefund(
        afterSale.id,
        expectedVersion,
        idempotencyKey,
        adminRemark,
      );
      attemptKeys.current.delete(afterSale.id);
      options.onSuccess();
    } catch (error) {
      if (error instanceof AdminApiError && error.status === 409) {
        attemptKeys.current.delete(afterSale.id);
        options.onConflictRefresh();
        return;
      }
      throw error;
    } finally {
      setPendingIds((current) => {
        const next = new Set(current);
        next.delete(afterSale.id);
        return next;
      });
    }
  };

  return {
    execute,
    isPending: (afterSaleId: string) => pendingIds.has(afterSaleId),
  };
}
