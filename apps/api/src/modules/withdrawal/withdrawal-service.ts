// L14.5 module boundary for withdrawal domain.
// TODO(L14.5): move withdrawal route state machine here without changing manual review/manual mark-paid behavior.
export const withdrawalServiceBoundary = {
  owns: ['createWithdrawal', 'approveWithdrawal', 'rejectWithdrawal', 'markWithdrawalPaid', 'reviewWithdrawalTax'] as const,
  payoutPolicy: 'manual-only-no-real-payout' as const
};
