import type { FastifyInstance } from 'fastify';
import { registerAdminAuthRoutes } from '../admin-auth.js';
import { registerLogRoutes } from '../logs.js';
import { registerFulfillmentRoutes } from '../fulfillment.js';
import { registerInventoryRoutes } from '../inventory.js';
import { registerSupplierRoutes } from '../suppliers.js';
import { registerCommissionRoutes } from '../commissions.js';
import { registerWithdrawalRoutes } from '../withdrawals.js';
import { registerAdminGroupBuyRoutes } from '../group-buys.js';
import { registerAdminAfterSaleRoutes } from '../after-sales.js';
import { registerAdminFinanceRoutes } from './finance.js';
import { registerAdminOperationsRoutes } from './operations.js';

export function registerAdminRoutes(app: FastifyInstance) {
  registerAdminAuthRoutes(app);
  registerLogRoutes(app);
  registerFulfillmentRoutes(app);
  registerAdminGroupBuyRoutes(app);
  registerInventoryRoutes(app);
  registerSupplierRoutes(app);
  registerCommissionRoutes(app);
  registerWithdrawalRoutes(app);
  registerAdminAfterSaleRoutes(app);
  registerAdminFinanceRoutes(app);
  registerAdminOperationsRoutes(app);
}
