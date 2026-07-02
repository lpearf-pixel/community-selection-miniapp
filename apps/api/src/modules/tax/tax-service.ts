// L14.5 module boundary for tax domain.
// Tax review remains human-operated and record-only; no external filing
// integration is introduced by this modular-monolith refactor.
export const taxServiceBoundary = {
  owns: ['createTaxRecord', 'reviewTax', 'listTaxRecords'] as const,
  filingPolicy: 'manual-review-only-no-auto-filing' as const
};

export function assertManualTaxPolicy() {
  return {
    review: 'manual-review-required' as const,
    externalTaxApi: false,
    autoFiling: false
  };
}
