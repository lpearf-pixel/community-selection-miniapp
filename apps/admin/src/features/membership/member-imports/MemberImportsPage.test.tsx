import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ADMIN_FEATURES } from '../../../app/feature-registry';
import { MemberImportsView } from './MemberImportsPage';

const fingerprint = 'a'.repeat(64);

describe('legacy member imports workbench', () => {
  it('is a full-access feature under membership and marketing', () => {
    expect(ADMIN_FEATURES.find((item) => item.key === 'memberImports')).toEqual({
      key: 'memberImports',
      label: '老会员导入',
      section: 'membership-marketing',
      requiredPermissions: ['admin.full_access'],
    });
  });

  it('shows the two-stage flow, accepted formats, masked rows and disabled-benefit warning', () => {
    const html = renderToStaticMarkup(
      <MemberImportsView
        sourceName="线下台账"
        fileName="members.xlsx"
        busy={false}
        error=""
        preview={{
          id: 'batch-1', status: 'preview',
          stats: { total: 1, valid: 1, duplicate: 0, invalid: 0, matched: 0, pending: 1 },
          rows: [{ id: 'row-1', rowNumber: 2, maskedPhone: '138****8000', phoneFingerprint: fingerprint, status: 'pending' }],
          eligibilities: [],
        }}
        history={[{ id: 'batch-1', sourceName: '线下台账', fileName: 'members.xlsx', status: 'preview', createdAt: '2026-07-31T00:00:00.000Z', stats: { total: 1, valid: 1, duplicate: 0, invalid: 0, matched: 0, pending: 1 } }]}
        onSourceChange={() => undefined}
        onFileChange={() => undefined}
        onPreview={() => undefined}
        onConfirm={() => undefined}
        onSelectBatch={() => undefined}
        onRevoke={() => undefined}
      />,
    );
    expect(html).toContain('accept=".csv,.xlsx"');
    expect(html).toContain('先预览，再确认导入');
    expect(html).toContain('会员优惠当前关闭，仅建立资格');
    expect(html).toContain('138****8000');
    expect(html).toContain('确认导入并建立资格');
    expect(html).not.toContain('13800138000');
    expect(html).not.toContain(fingerprint);
  });

  it('renders revoke only for unused eligibility', () => {
    const html = renderToStaticMarkup(
      <MemberImportsView
        sourceName="线下台账" fileName="members.csv" busy={false} error=""
        preview={{
          id: 'batch-1', status: 'confirmed',
          stats: { total: 2, valid: 2, duplicate: 0, invalid: 0, matched: 1, pending: 1 },
          rows: [],
          eligibilities: [
            { id: 'e-1', maskedPhone: '138****8000', status: 'pending' },
            { id: 'e-2', maskedPhone: '139****9000', status: 'used' },
          ],
        }}
        history={[]}
        onSourceChange={() => undefined} onFileChange={() => undefined}
        onPreview={() => undefined} onConfirm={() => undefined}
        onSelectBatch={() => undefined} onRevoke={() => undefined}
      />,
    );
    expect((html.match(/撤销未使用资格/g) ?? [])).toHaveLength(1);
    expect(html).toContain('已使用');
  });
});
