import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { publicCurrentUserError } from '../modules/current-user/current-user-security.js';
import {
  GiftPolicyError,
  claimGift,
  releaseUncollectedGift,
} from '../modules/membership/member-gift-service.js';
import { PrismaMemberGiftRepository } from '../modules/membership/member-gift-repository.js';
import {
  MembershipPolicyError,
  activateLegacyMembership,
} from '../modules/membership/membership-lifecycle.js';
import {
  PrismaMembershipRepository,
  getMembershipEntitlement,
} from '../modules/membership/membership-repository.js';
import { withCurrentUser } from './current-user-route.js';
import {
  createPaidMembershipOrder,
  createPrismaMembershipPaymentStore,
  markMembershipOrderPaid,
  MEMBERSHIP_ANNUAL_PRICE_CENTS,
} from '../modules/membership/membership-paid-order.js';
import { createWechatPaymentCommand } from '../modules/payment/wechat-payment-command.js';
import { loadWechatRuntimeConfig } from '../modules/wechat/wechat-config.js';
import {
  createJsapiPaySignature,
  createWechatPayV3Client,
} from '../modules/wechat/wechat-pay-v3-client.js';

type MembershipRouteOptions = {
  enabled?: boolean;
  getStatus?: (userId: string) => Promise<unknown>;
  activateLegacy?: (input: {
    userId: string; eligibilityId: string; idempotencyKey: string; now: Date;
  }) => Promise<unknown>;
  claimGift?: (input: {
    userId: string; orderId: string; campaignId: string; quantity: 1; idempotencyKey: string; now: Date;
  }) => Promise<unknown>;
  releaseGift?: (input: {
    userId: string; claimId: string; idempotencyKey: string; now: Date;
  }) => Promise<unknown>;
  createPaidOrder?: (input: { userId: string; idempotencyKey: string }) => Promise<unknown>;
  payPaidOrderMock?: (input: { userId: string; membershipOrderId: string }) => Promise<unknown>;
  initializePaidOrderWechat?: (input: {
    userId: string; membershipOrderId: string; clientIp?: string;
  }) => Promise<unknown>;
};

function exactBody(body: unknown, keys: readonly string[]) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw publicCurrentUserError('请求参数不合法', 400);
  }
  const entries = Object.entries(body);
  if (entries.length !== keys.length || entries.some(([key]) => !keys.includes(key))) {
    throw publicCurrentUserError('请求参数不合法', 400);
  }
  const value = body as Record<string, unknown>;
  for (const key of keys) {
    if (typeof value[key] !== 'string' || !(value[key] as string).trim()) {
      throw publicCurrentUserError('请求参数不合法', 400);
    }
  }
  return Object.fromEntries(keys.map((key) => [key, (value[key] as string).trim()]));
}

function exactEmptyBody(body: unknown) {
  if (body === undefined || body === null) return;
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 0) {
    throw publicCurrentUserError('请求参数不合法', 400);
  }
}

function paymentMode() {
  return process.env.WECHAT_PAY_MODE === 'wechat' && process.env.MOCK_WECHAT_PAY !== 'true'
    ? 'wechat' as const
    : 'mock' as const;
}

function defaultMembershipWechatInitializer() {
  const config = loadWechatRuntimeConfig();
  if (config.paymentMode !== 'wechat') throw new Error('WECHAT_PAYMENT_MODE_DISABLED');
  const privateKey = readFileSync(config.merchantPrivateKeyPath);
  const payClient = createWechatPayV3Client({
    appId: config.appId, merchantId: config.merchantId, serialNo: config.merchantSerialNo,
    privateKey, platformSerialNo: config.platformSerialNo,
    platformPublicKey: readFileSync(config.platformCertificatePath),
    paymentNotifyUrl: config.paymentNotifyUrl, refundNotifyUrl: config.refundNotifyUrl,
  });
  return createWechatPaymentCommand({
    store: createPrismaMembershipPaymentStore(), payClient,
    signJsapi: ({ prepayId }) => createJsapiPaySignature({ appId: config.appId, prepayId, privateKey }),
  }).initialize;
}

async function safeDomainCall<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof MembershipPolicyError || error instanceof GiftPolicyError) {
      const statusCode = error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 409;
      throw publicCurrentUserError(error.message, statusCode);
    }
    throw error;
  }
}

export function registerMembershipRoutes(app: FastifyInstance, options: MembershipRouteOptions = {}) {
  const enabled = options.enabled ?? process.env.MEMBERSHIP_ENABLED === 'true';
  const membershipRepository = new PrismaMembershipRepository();
  const giftRepository = new PrismaMemberGiftRepository();
  const getStatus = options.getStatus ?? (async (userId: string) => {
    const now = new Date();
    const [entitlement, eligibility, campaigns, claims, membershipOrders] = await Promise.all([
      getMembershipEntitlement(userId, now),
      prisma.legacyMemberEligibility.findUnique({ where: { user_id: userId } }),
      prisma.memberGiftCampaign.findMany({
        where: { status: 'active', starts_at: { lte: now }, ends_at: { gt: now } },
        include: { gift_product: { select: { name: true } } },
        orderBy: { starts_at: 'desc' }, take: 20,
      }),
      prisma.memberGiftClaim.findMany({
        where: { user_id: userId }, include: { campaign: { select: { name: true } } },
        orderBy: { created_at: 'desc' }, take: 50,
      }),
      prisma.membershipOrder.findMany({
        where: { user_id: userId }, orderBy: { created_at: 'desc' }, take: 10,
        select: {
          id: true, order_no: true, amount_cents: true, status: true,
          membership_period_id: true, paid_at: true, created_at: true,
        },
      }),
    ]);
    return {
      feature_enabled: enabled,
      annual_price_cents: MEMBERSHIP_ANNUAL_PRICE_CENTS,
      ...entitlement,
      legacy_eligibility: eligibility ? {
        id: eligibility.id,
        status: eligibility.status,
        grant_type: eligibility.grant_type,
      } : null,
      active_gift_campaigns: campaigns.map((item) => ({
        id: item.id, name: item.name, gift_product_name: item.gift_product.name,
        starts_at: item.starts_at, ends_at: item.ends_at,
      })),
      gift_claims: claims.map((item) => ({
        id: item.id, order_id: item.order_id, campaign_id: item.campaign_id,
        campaign_name: item.campaign.name, status: item.status,
        fulfillment_started_at: item.fulfillment_started_at,
        created_at: item.created_at,
      })),
      membership_orders: membershipOrders,
    };
  });
  const activateLegacy = options.activateLegacy ?? ((input) =>
    activateLegacyMembership({ ...input, enabled }, membershipRepository));
  const claim = options.claimGift ?? (async (input) => {
    const membership = await getMembershipEntitlement(input.userId, input.now);
    return claimGift({ ...input, enabled, membership }, giftRepository);
  });
  const release = options.releaseGift ?? ((input) =>
    releaseUncollectedGift({ ...input, enabled }, giftRepository));
  const createOrder = options.createPaidOrder ?? ((input) =>
    createPaidMembershipOrder({ ...input, enabled }));
  const mockPay = options.payPaidOrderMock ?? (async (input) => {
    const existing = await prisma.membershipOrder.findUnique({
      where: { id: input.membershipOrderId }, include: { membership_period: true },
    });
    if (!existing) throw publicCurrentUserError('会员订单不存在', 404);
    if (existing.user_id !== input.userId) throw publicCurrentUserError('会员订单不属于当前用户', 403);
    if (existing.status === 'paid' && existing.membership_period) {
      return {
        membership_order_id: existing.id, status: existing.status,
        membership_period_id: existing.membership_period.id,
        starts_at: existing.membership_period.starts_at, ends_at: existing.membership_period.ends_at,
      };
    }
    const prepared = await createPrismaMembershipPaymentStore().prepare(
      input.userId, input.membershipOrderId, new Date(),
    );
    return markMembershipOrderPaid(input.membershipOrderId, {
      payment_id: prepared.payment.id, out_trade_no: prepared.payment.out_trade_no,
      transaction_id: `MOCK${prepared.payment.out_trade_no}`,
      provider_success_at: new Date(),
    });
  });

  app.get('/api/me/membership', (request, reply) =>
    withCurrentUser(request, reply, '会员状态查询失败', (user) => getStatus(user.id)));

  app.post('/api/me/membership/legacy-activate', (request, reply) =>
    withCurrentUser(request, reply, '老会员激活失败', async (user) => {
      const body = exactBody(request.body, ['eligibility_id', 'idempotency_key']);
      if (!enabled) throw publicCurrentUserError('会员功能未启用', 409);
      return safeDomainCall(() => activateLegacy({
        userId: user.id,
        eligibilityId: body.eligibility_id,
        idempotencyKey: body.idempotency_key,
        now: new Date(),
      }));
    }));

  app.post('/api/me/membership/orders', (request, reply) =>
    withCurrentUser(request, reply, '会员订单创建失败', async (user) => {
      const body = exactBody(request.body, ['idempotency_key']);
      if (!enabled) throw publicCurrentUserError('会员功能未启用', 409);
      return safeDomainCall(() => createOrder({ userId: user.id, idempotencyKey: body.idempotency_key }));
    }));

  app.post('/api/me/membership/orders/:id/mock-pay', (request, reply) =>
    withCurrentUser(request, reply, '会员支付失败', async (user) => {
      exactEmptyBody(request.body);
      if (!enabled || paymentMode() !== 'mock') throw publicCurrentUserError('会员 Mock 支付未启用', 409);
      return safeDomainCall(() => mockPay({
        userId: user.id, membershipOrderId: (request.params as { id: string }).id,
      }));
    }));

  app.post('/api/me/membership/orders/:id/wechat-jsapi', (request, reply) =>
    withCurrentUser(request, reply, '会员微信支付初始化失败', async (user) => {
      exactEmptyBody(request.body);
      if (!enabled || paymentMode() !== 'wechat') throw publicCurrentUserError('微信支付模式未启用', 409);
      const membershipOrderId = (request.params as { id: string }).id;
      const result = await safeDomainCall(() => options.initializePaidOrderWechat
        ? options.initializePaidOrderWechat({
            userId: user.id, membershipOrderId, clientIp: request.ip,
          })
        : defaultMembershipWechatInitializer()({
            userId: user.id, orderId: membershipOrderId, clientIp: request.ip,
          }));
      if (result && typeof result === 'object' && 'order_id' in result) {
        const { order_id, ...rest } = result as Record<string, unknown>;
        return { membership_order_id: order_id, ...rest };
      }
      return result;
    }));

  app.post('/api/me/member-gifts/claim', (request, reply) =>
    withCurrentUser(request, reply, '会员赠品领取失败', async (user) => {
      const body = exactBody(request.body, ['campaign_id', 'order_id', 'idempotency_key']);
      if (!enabled) throw publicCurrentUserError('会员功能未启用', 409);
      return safeDomainCall(() => claim({
        userId: user.id, orderId: body.order_id, campaignId: body.campaign_id, quantity: 1,
        idempotencyKey: body.idempotency_key, now: new Date(),
      }));
    }));

  app.post('/api/me/member-gifts/:id/release', (request, reply) =>
    withCurrentUser(request, reply, '会员赠品取消失败', async (user) => {
      const body = exactBody(request.body, ['idempotency_key']);
      if (!enabled) throw publicCurrentUserError('会员功能未启用', 409);
      return safeDomainCall(() => release({
        userId: user.id, claimId: (request.params as { id: string }).id,
        idempotencyKey: body.idempotency_key, now: new Date(),
      }));
    }));
}
