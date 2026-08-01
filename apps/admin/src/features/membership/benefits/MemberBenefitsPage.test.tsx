import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ADMIN_FEATURES } from '../../../app/feature-registry';
import { MemberBenefitsView } from './MemberBenefitsPage';

describe('member benefits operations workbench', () => {
  it('is an order-managed feature under membership and marketing', () => {
    expect(ADMIN_FEATURES.find((item) => item.key === 'memberBenefits')).toEqual({
      key: 'memberBenefits', label: '会员权益履约', section: 'membership-marketing',
      requiredPermissions: ['order.manage'],
    });
  });

  it('shows gift fulfillment evidence and only valid operational actions', () => {
    const html = renderToStaticMarkup(<MemberBenefitsView
      busy={false}
      error=""
      items={[
        { claim_id: 'claim-1', order_id: 'order-1', order_no: 'ORDER-1', user_nickname: '会员甲', campaign_name: '新品试吃', gift_product_name: '有机番茄', status: 'reserved', fulfillment_started_at: null, created_at: '2026-07-31T00:00:00.000Z' },
        { claim_id: 'claim-2', order_id: 'order-2', order_no: 'ORDER-2', user_nickname: '会员乙', campaign_name: '新品试吃', gift_product_name: '有机番茄', status: 'delivered', fulfillment_started_at: '2026-07-31T01:00:00.000Z', created_at: '2026-07-31T00:30:00.000Z' },
      ]}
      writeOffReasons={{}} onWriteOffReasonChange={vi.fn()}
      onRefresh={vi.fn()} onDeliver={vi.fn()} onWriteOff={vi.fn()}
    />);
    expect(html).toContain('ORDER-1');
    expect(html).toContain('有机番茄');
    expect(html).toContain('确认交付');
    expect(html).toContain('报损');
    expect(html).toContain('选择报损原因');
    expect(html).toContain('丢失');
    expect(html).toContain('不可售');
    const deliveredRow = html.match(/<tr><td>ORDER-2[\s\S]*?<\/tr>/)?.[0] ?? '';
    expect(deliveredRow).not.toContain('确认交付');
    expect(deliveredRow).not.toContain('报损');
    expect(html).toContain('已交付');
  });
});
