// L14.5 module boundary for purchase domain.
// TODO(L14.5): move purchase plan create/confirm/cancel/receive route bodies here while preserving purchase_in and purchase_batch_in ledgers.
export const purchaseServiceBoundary = {
  owns: ['createPurchasePlan', 'confirmPurchasePlan', 'cancelPurchasePlan', 'receivePurchasePlan'] as const,
  statuses: ['draft', 'confirmed', 'ordered', 'received', 'cancelled'] as const
};
