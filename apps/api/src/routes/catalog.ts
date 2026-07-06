import type { FastifyInstance } from 'fastify';
import { ok } from '@community-selection/shared';
import { prisma } from '../db.js';


export function registerCatalogRoutes(app: FastifyInstance) {
  app.get('/api/categories', async () => {
    const categories = await prisma.category.findMany({
      where: { status: 'active' },
      orderBy: [{ sort_order: 'asc' }, { created_at: 'desc' }]
    });
    return ok(categories);
  });

  app.get('/api/communities', async () => {
    const communities = await prisma.community.findMany({
      where: { status: 'active' },
      orderBy: { created_at: 'desc' }
    });
    return ok(communities);
  });

  app.get('/api/pickup-stores', async () => {
    const stores = await prisma.pickupStore.findMany({
      where: { status: 'active' },
      orderBy: { created_at: 'desc' }
    });
    return ok(stores);
  });
}
