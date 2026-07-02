import type { FastifyInstance } from 'fastify';
import { registerAdminAuthRoutes } from '../admin-auth.js';
import { registerLogRoutes } from '../logs.js';
import { registerFulfillmentRoutes } from '../fulfillment.js';
import { registerInventoryRoutes } from '../inventory.js';
import { registerSupplierRoutes } from '../suppliers.js';
import { registerCommissionRoutes } from '../commissions.js';
import { registerWithdrawalRoutes } from '../withdrawals.js';

export function registerAdminRoutes(app: FastifyInstance) {
  registerAdminAuthRoutes(app);
  registerLogRoutes(app);
  registerFulfillmentRoutes(app);
  registerInventoryRoutes(app);
  registerSupplierRoutes(app);
  registerCommissionRoutes(app);
  registerWithdrawalRoutes(app);
}
