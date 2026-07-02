// L14.5 module boundary for withdrawal domain.
// The current withdrawal routes keep URL/state-machine behavior in place; these
// helpers document and centralize policy constants until the route-local
// transition code is migrated in a later refactor-only pass.
export const withdrawalServiceBoundary = {
  owns: ['createWithdrawal', 'approveWithdrawal', 'rejectWithdrawal', 'markWithdrawalPaid', 'reviewWithdrawalTax'] as const,
  payoutPolicy: 'manual-only-no-real-payout' as const
};

export function assertManualWithdrawalPolicy() {
  return {
    approval: 'manual-review-required' as const,
    paidMarking: 'manual-mark-paid-only' as const,
    realPayout: false,
    autoTaxFiling: false
  };
}
