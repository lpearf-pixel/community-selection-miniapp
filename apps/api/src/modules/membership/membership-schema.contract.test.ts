import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../../../..');
const schema = readFileSync(resolve(root, 'prisma/schema.prisma'), 'utf8');
const migration = readFileSync(
  resolve(root, 'prisma/migrations/202607310001_l56_membership_pricing_gifts/migration.sql'),
  'utf8',
);

describe('L56 membership schema contract', () => {
  it('keeps legacy eligibility consumption and activation idempotency unique', () => {
    expect(schema).toContain('membership_period_id  String?');
    expect(migration).toContain('MembershipPeriod_idempotency_key_key');
    expect(migration).toContain('LegacyMemberEligibility_membership_period_id_key');
  });

  it('stores immutable order pricing evidence', () => {
    for (const field of ['unit_price_cents', 'price_source', 'pricing_snapshot', 'membership_period_id']) {
      expect(schema).toContain(field);
    }
  });

  it('keeps the 88 yuan membership payment separate from commodity orders', () => {
    expect(schema).toContain('model MembershipOrder');
    expect(schema).toContain('model MembershipPayment');
    expect(migration).toContain('MembershipOrder_amount_check');
    expect(migration).toContain('"amount_cents" = 8800');
    expect(migration).toContain('MembershipOrder_paid_evidence_check');
  });

  it('enforces nonnegative bounded gift inventory in PostgreSQL', () => {
    expect(migration).toContain('MemberGiftCampaign_inventory_check');
    expect(migration).toContain('"inventory_reserved" + "inventory_delivered" + "inventory_written_off" <= "inventory_total"');
    expect(migration).toContain('MemberGiftClaim_quantity_check');
  });
});
