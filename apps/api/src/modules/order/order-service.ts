// L14.5 module boundary for order domain.
// The first integrated extraction is inventory locking via modules/inventory from group-buy order creation.
// TODO(L14.5): move createGroupOrder/updateOrderStatus/pickupVerify handlers here without changing URLs or transaction semantics.
export type CreateGroupOrderServiceInput = {
  group_buy_id: string;
  user_id?: string;
  user_openid?: string;
  client_request_id: string;
  quantity: number;
  receiver_name: string;
  receiver_phone: string;
};

export type UpdateOrderStatusServiceInput = {
  order_id: string;
  next_status: string;
  admin_user_id?: string | null;
};

export const orderServiceBoundary = {
  owns: ['createGroupOrder', 'updateOrderStatus', 'pickupVerify', 'listOrders', 'getOrderDetail'] as const,
  transactionRules: ['idempotent order create', 'inventory lock in same transaction', 'timeline/business/admin audit writes'] as const
};
