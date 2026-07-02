import type { FastifyInstance } from 'fastify';
import { ProductStatus } from '@prisma/client';
import { fail, ok } from '@community-selection/shared';
import { prisma } from '../db.js';

function toInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function registerCatalogRoutes(app: FastifyInstance) {
  app.get('/api/categories', async () => {
    const categories = await prisma.category.findMany({
      where: { status: 'active' },
      orderBy: [{ sort_order: 'asc' }, { created_at: 'desc' }]
    });
    return ok(categories);
  });

  app.get('/api/products', async (request) => {
    const query = request.query as { category_id?: string; status?: string; page?: string; page_size?: string };
    const page = toInt(query.page, 1);
    const pageSize = Math.min(toInt(query.page_size, 20), 100);
    const status: ProductStatus = query.status === ProductStatus.draft
      ? ProductStatus.draft
      : query.status === ProductStatus.inactive
        ? ProductStatus.inactive
        : ProductStatus.active;
    const where = {
      status,
      ...(query.category_id ? { category_id: query.category_id } : {})
    };
    const [items, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: { category: true },
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      prisma.product.count({ where })
    ]);
    return ok({ items, total, page, page_size: pageSize });
  });

  app.get('/api/products/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const product = await prisma.product.findUnique({
      where: { id },
      include: { category: true }
    });
    if (!product) {
      reply.code(404);
      return fail('商品不存在');
    }
    return ok(product);
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
