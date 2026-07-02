// L14.5 module boundary for supplier domain.
// TODO(L14.5): move supplier route transactions here without changing admin audit actions.
export const supplierServiceBoundary = {
  owns: ['listSuppliers', 'createSupplier', 'updateSupplier', 'disableSupplier'] as const,
  deletePolicy: 'disable-only' as const
};
