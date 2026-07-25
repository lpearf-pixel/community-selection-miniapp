import {
  approveWithdrawal,
  markWithdrawalPaid,
  rejectWithdrawal,
} from './api';
import type { Withdrawal } from './types';

export type WithdrawalCommandAction = 'approve' | 'reject' | 'mark-paid';

function commandKey(action: WithdrawalCommandAction): string {
  const nonce = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `admin-withdrawal-${action}-${nonce}`;
}

export function executeWithdrawalCommand(
  item: Withdrawal,
  action: WithdrawalCommandAction,
  value: string,
): Promise<void> {
  const key = commandKey(action);
  if (action === 'approve') {
    return approveWithdrawal(item.withdrawal_id, item.version, key, value);
  }
  if (action === 'reject') {
    return rejectWithdrawal(item.withdrawal_id, item.version, key, value);
  }
  return markWithdrawalPaid(
    item.withdrawal_id,
    item.version,
    key,
    value,
    '人工处理完成',
  );
}
