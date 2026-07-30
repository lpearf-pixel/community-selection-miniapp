import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SupplierComplianceCard } from './SuppliersPage';

describe('SupplierComplianceCard', () => {
  it('shows subject completeness, qualification status and expiry only', () => {
    const html = renderToStaticMarkup(
      <SupplierComplianceCard
        state={{
          id: 'supplier-1',
          name: '众彩 A18 档口',
          subject_type: 'market_stall',
          status: 'active',
          source_complete: true,
          qualifications: [
            {
              id: 'qualification-1',
              qualification_type: 'market_stall_registration',
              version: 2,
              status: 'approved',
              valid_from: '2026-01-01T00:00:00.000Z',
              expires_at: '2027-01-01T00:00:00.000Z',
              masked_summary: {
                object_key: 'compliance/private/stall.pdf',
              },
            },
          ],
        }}
      />,
    );
    expect(html).toContain('批发市场档口');
    expect(html).toContain('完整');
    expect(html).toContain('approved');
    expect(html).toContain('2027-01-01');
    expect(html).not.toContain('compliance/private');
    expect(html).not.toContain('object_key');
  });
});
