// L14.5 module boundary for tax domain.
// TODO(L14.5): move tax record listing/review helpers here. No external tax filing integration is allowed.
export const taxServiceBoundary = {
  owns: ['createTaxRecord', 'reviewTax', 'listTaxRecords'] as const,
  filingPolicy: 'manual-review-only-no-auto-filing' as const
};
