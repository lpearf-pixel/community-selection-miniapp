type DueOrder = {
  id: string;
  quantity: number;
  pay_status: string;
  order_status: string;
  pay_amount_cents: number;
  payments: Array<{ id: string; out_trade_no: string }>;
};

type DueGroup = {
  id: string;
  min_quantity: number;
  orders: DueOrder[];
};

export function createWechatGroupExpiryCommand(options: {
  acquireLock(): Promise<boolean>;
  listDueGroups(now: Date): Promise<DueGroup[]>;
  queryTransaction(outTradeNo: string): Promise<Record<string, unknown>>;
  convergePayment(
    order: DueOrder,
    provider: Record<string, unknown>,
  ): Promise<void>;
  refreshGroupProgress(groupId: string): Promise<{
    paid_quantity: number;
    paid_orders: Array<{
      id: string;
      pay_amount_cents: number;
    }>;
  }>;
  closeUnpaidOrders(groupId: string): Promise<void>;
  markGroupSuccess(groupId: string, paidQuantity: number): Promise<void>;
  markGroupFailed(groupId: string, paidQuantity: number): Promise<void>;
  submitRefund(input: {
    order_id: string;
    client_refund_id: string;
    refund_amount_cents: number;
    reason: string;
  }): Promise<unknown>;
  upsertAlert(key: string, input: Record<string, unknown>): Promise<unknown>;
}) {
  return {
    async expire(now: Date) {
      if (!(await options.acquireLock())) {
        return { skipped: true, groups: 0 };
      }
      const groups = await options.listDueGroups(now);
      for (const group of groups) {
        for (const order of group.orders) {
          if (
            order.pay_status !== 'unpaid' ||
            order.order_status === 'closed'
          ) {
            continue;
          }
          const payment = order.payments[0];
          if (!payment) continue;
          try {
            const provider = await options.queryTransaction(
              payment.out_trade_no,
            );
            if (provider.trade_state === 'SUCCESS') {
              await options.convergePayment(order, provider);
            }
          } catch (error) {
            await options.upsertAlert(
              `group-expiry:${group.id}:${order.id}:query`,
              { group_buy_id: group.id, order_id: order.id },
            );
          }
        }
        const progress = await options.refreshGroupProgress(group.id);
        await options.closeUnpaidOrders(group.id);
        if (progress.paid_quantity >= group.min_quantity) {
          await options.markGroupSuccess(group.id, progress.paid_quantity);
          continue;
        }
        await options.markGroupFailed(group.id, progress.paid_quantity);
        for (const order of progress.paid_orders) {
          await options.submitRefund({
            order_id: order.id,
            client_refund_id: `group-failed:${group.id}:${order.id}`,
            refund_amount_cents: order.pay_amount_cents,
            reason: '拼团到期未成团',
          });
        }
      }
      return { skipped: false, groups: groups.length };
    },
  };
}

export function expireDueWechatGroupBuys(
  command: ReturnType<typeof createWechatGroupExpiryCommand>,
  now = new Date(),
) {
  return command.expire(now);
}
