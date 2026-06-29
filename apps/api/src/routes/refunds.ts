import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { fail, ok } from '@community-selection/shared';
import { prisma } from '../db.js';

type CreateRefundBody = {
  order_id?: string;
  refund_amount_cents?: number;
  reason?: string;
};

type AuditRefundBody = {
  action?: 'approve' | 'reject';
  reason?: string;
};

type RefundSuccessBody = {
  refund_id?: string;
  out_refund_no?: string;
};

function positiveAmount(value: unknown): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function isMockRefundEnabled(): boolean {
  if (process.env.MOCK_WECHAT_PAY === 'true') return true;
  if (process.env.MOCK_WECHAT_PAY === 'false') return false;
  return process.env.WECHAT_PAY_MODE !== 'wechat';
}

function makeOutRefundNo(orderNo: string): string {
  return `REF${orderNo}${Date.now()}`;
}

async function findRefund(body: RefundSuccessBody) {
  if (body.refund_id) return prisma.refund.findUnique({ where: { id: body.refund_id } });
  if (body.out_refund_no) return prisma.refund.findUnique({ where: { out_refund_no: body.out_refund_no } });
  return null;
}

async function markRefundSuccess(refundId: string) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const refund = await tx.refund.findUnique({ where: { id: refundId }, include: { order: true } });
    if (!refund) throw new Error('退款单不存在');
    if (refund.status === 'success') return refund;
    if (refund.status === 'rejected') throw new Error('已拒绝退款不可成功');

    const nextRefundAmount = refund.order.refund_amount_cents + refund.refund_amount_cents;
    if (nextRefundAmount > refund.order.pay_amount_cents) throw new Error('退款金额超过订单实付金额');

    const nextOrderStatus = nextRefundAmount >= refund.order.pay_amount_cents ? 'refunded' : refund.order.order_status;
    const updatedRefund = await tx.refund.update({
      where: { id: refund.id },
      data: { status: 'success' }
    });
    await tx.order.update({
      where: { id: refund.order_id },
      data: {
        refund_amount_cents: nextRefundAmount,
        refund_status: 'success',
        order_status: nextOrderStatus
      }
    });
    await tx.auditLog.create({
      data: {
        action: 'refund_success',
        target_type: 'Refund',
        target_id: refund.id,
        payload: {
          order_id: refund.order_id,
          refund_amount_cents: refund.refund_amount_cents,
          total_refund_amount_cents: nextRefundAmount
        }
      }
    });
    return updatedRefund;
  });
}

export function registerRefundRoutes(app: FastifyInstance) {
  app.post('/api/refunds', async (request, reply) => {
    const body = request.body as CreateRefundBody;
    const amount = positiveAmount(body.refund_amount_cents);
    if (!body.order_id || amount <= 0 || !body.reason) {
      reply.code(400);
      return fail('缺少退款必填字段');
    }

    try {
      const order = await prisma.order.findUnique({ where: { id: body.order_id } });
      if (!order) throw new Error('订单不存在');
      if (order.pay_status !== 'paid') throw new Error('未支付订单不能退款');
      if (order.refund_amount_cents >= order.pay_amount_cents) throw new Error('订单已全额退款');
      const remainingAmount = order.pay_amount_cents - order.refund_amount_cents;
      if (amount > remainingAmount) throw new Error('退款金额超过订单实付金额');

      const refund = await prisma.refund.create({
        data: {
          order_id: order.id,
          out_refund_no: makeOutRefundNo(order.order_no),
          refund_amount_cents: amount,
          reason: body.reason,
          status: 'pending'
        }
      });
      await prisma.order.update({
        where: { id: order.id },
        data: {
          refund_status: 'pending',
          order_status: amount === remainingAmount ? 'refunding' : order.order_status
        }
      });
      return ok(refund);
    } catch (error) {
      reply.code(400);
      return fail(error instanceof Error ? error.message : '退款申请失败');
    }
  });

  app.get('/api/refunds/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const refund = await prisma.refund.findUnique({ where: { id }, include: { order: true } });
    if (!refund) {
      reply.code(404);
      return fail('退款单不存在');
    }
    return ok(refund);
  });

  app.post('/api/refunds/:id/audit', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as AuditRefundBody;
    if (body.action !== 'approve' && body.action !== 'reject') {
      reply.code(400);
      return fail('缺少退款审核动作');
    }

    try {
      const refund = await prisma.refund.findUnique({ where: { id } });
      if (!refund) throw new Error('退款单不存在');
      if (refund.status === 'success') throw new Error('已成功退款不可重复审核');
      const status = body.action === 'approve' ? 'approved' : 'rejected';
      const updatedRefund = await prisma.refund.update({
        where: { id },
        data: { status, raw_notify: body.reason ? { audit_reason: body.reason } : undefined }
      });
      await prisma.order.update({
        where: { id: refund.order_id },
        data: { refund_status: status }
      });
      return ok(updatedRefund);
    } catch (error) {
      reply.code(400);
      return fail(error instanceof Error ? error.message : '退款审核失败');
    }
  });

  app.post('/api/refunds/mock/success', async (request, reply) => {
    if (!isMockRefundEnabled()) {
      reply.code(403);
      return fail('仅 MOCK 模式允许模拟退款成功');
    }

    try {
      const refund = await findRefund(request.body as RefundSuccessBody);
      if (!refund) throw new Error('退款单不存在');
      return ok(await markRefundSuccess(refund.id));
    } catch (error) {
      reply.code(400);
      return fail(error instanceof Error ? error.message : '模拟退款失败');
    }
  });

  app.post('/api/refunds/wechat/notify', async (_request, reply) => {
    if (isMockRefundEnabled()) {
      reply.code(403);
      return fail('MOCK 模式拒绝真实微信退款回调');
    }
    reply.code(501);
    return fail('真实微信退款回调待实现：TODO 验签、解密、金额校验、幂等更新；未完成验签前不得修改订单');
  });
}
