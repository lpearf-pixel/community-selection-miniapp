import type { FastifyInstance } from 'fastify';
import { registerCatalogRoutes } from '../catalog.js';
import { registerUserProductRoutes } from './products.js';
import { registerPublicGroupBuyRoutes } from '../group-buys.js';
import { registerPaymentRoutes } from '../payments.js';
import { registerRefundRoutes } from '../refunds.js';
import { registerRewardRoutes } from '../rewards.js';
import { registerPublicAfterSaleRoutes } from '../after-sales.js';
import { registerMeCenterRoutes } from '../me/center.js';
import { registerUserOrderRoutes } from '../me/orders.js';
import { registerLeaderCenterRoutes } from '../leaders/center.js';
import { registerPublicLocationRoutes } from './locations.js';
import { registerPublicDeliveryRoutes } from './delivery.js';
import { registerWechatAuthRoutes } from '../wechat-auth.js';
import { registerMembershipRoutes } from '../membership.js';

export function registerPublicRoutes(app: FastifyInstance) {
  registerWechatAuthRoutes(app);
  registerMembershipRoutes(app);
  registerCatalogRoutes(app);
  registerUserProductRoutes(app);
  registerPublicLocationRoutes(app);
  registerPublicDeliveryRoutes(app);
  registerPublicGroupBuyRoutes(app);
  registerPaymentRoutes(app);
  registerRefundRoutes(app);
  registerRewardRoutes(app);
  registerPublicAfterSaleRoutes(app);
  registerUserOrderRoutes(app);
  registerMeCenterRoutes(app);
  registerLeaderCenterRoutes(app);
}
