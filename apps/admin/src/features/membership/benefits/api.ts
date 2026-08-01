import { adminJsonRequest } from '../../../shared/api/admin-api';

export type MemberGiftClaimItem = {
  claim_id: string;
  order_id: string;
  order_no: string;
  user_nickname: string;
  campaign_name: string;
  gift_product_name: string;
  status: 'reserved' | 'released' | 'delivered' | 'written_off';
  fulfillment_started_at: string | null;
  created_at: string;
};

export const listMemberGiftClaims = () =>
  adminJsonRequest<{ items: MemberGiftClaimItem[] }>('/api/admin/member-gift-claims');

export const deliverMemberGift = (claimId: string, idempotencyKey: string) =>
  adminJsonRequest(`/api/admin/member-gift-claims/${claimId}/deliver`, {
    method: 'POST', body: JSON.stringify({ idempotency_key: idempotencyKey }),
  });

export const writeOffMemberGift = (
  claimId: string,
  reason: 'damaged' | 'lost' | 'unsellable',
  idempotencyKey: string,
) => adminJsonRequest(`/api/admin/member-gift-claims/${claimId}/write-off`, {
  method: 'POST', body: JSON.stringify({ reason, idempotency_key: idempotencyKey }),
});
