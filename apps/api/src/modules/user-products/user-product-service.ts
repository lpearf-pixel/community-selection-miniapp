import type { Prisma } from '@prisma/client';
import { prisma } from '../../db.js';

type ProductListQuery = {
  category_id?: string;
  keyword?: string;
  page?: string | number;
  page_size?: string | number;
  only_group_enabled?: string | boolean;
  only_in_stock?: string | boolean;
};

type GroupBuyListQuery = {
  community_id?: string;
  page?: string | number;
  page_size?: string | number;
};

const ACTIVE_GROUP_BUY_STATUS = ['pending', 'success'] as const;

function positiveInt(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function pageParams(query: { page?: unknown; page_size?: unknown }) {
  const page = positiveInt(query.page, 1);
  const pageSize = Math.min(positiveInt(query.page_size, 20), 100);
  return { page, pageSize };
}

function booleanQuery(value: unknown) {
  return value === true || value === 'true' || value === '1';
}

function displayStock(product: { stock: number; stock_unit: string | null }) {
  return `${product.stock} ${product.stock_unit ?? ''}`.trim();
}

function imagesOf(value: Prisma.JsonValue): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function activeGroupBuyWhere(query?: GroupBuyListQuery): Prisma.GroupBuyWhereInput {
  return {
    status: { in: [...ACTIVE_GROUP_BUY_STATUS] },
    end_time: { gt: new Date() },
    ...(query?.community_id ? { community_id: query.community_id } : {})
  };
}

function groupBuyWhere(productId: string, query?: GroupBuyListQuery): Prisma.GroupBuyWhereInput {
  return {
    product_id: productId,
    ...activeGroupBuyWhere(query)
  };
}

async function getPaidQuantity(groupBuyId: string) {
  const result = await prisma.order.aggregate({
    where: {
      group_buy_id: groupBuyId,
      pay_status: 'paid',
      order_status: { notIn: ['closed', 'refunded'] },
      refund_status: { notIn: ['success'] }
    },
    _sum: { quantity: true }
  });
  return result._sum.quantity ?? 0;
}

async function mapGroupBuy(groupBuy: any) {
  const paidQuantity = await getPaidQuantity(groupBuy.id);
  const targetCount = groupBuy.min_quantity;
  const remainingQuantity = Math.max(0, targetCount - paidQuantity);
  const isExpired = groupBuy.end_time.getTime() <= Date.now();
  return {
    group_buy_id: groupBuy.id,
    community_id: groupBuy.community_id,
    community_name: groupBuy.community?.name ?? '',
    leader_user_id: groupBuy.leader_user_id,
    leader_nickname: groupBuy.leader_user?.nickname ?? '',
    min_people: groupBuy.min_people,
    min_quantity: groupBuy.min_quantity,
    target_count: targetCount,
    current_people: groupBuy.current_people,
    current_quantity: groupBuy.current_quantity,
    paid_quantity: paidQuantity,
    remaining_quantity: remainingQuantity,
    price_cents: groupBuy.price_cents,
    status: groupBuy.status,
    is_success: groupBuy.status === 'success',
    is_expired: isExpired,
    can_join: (groupBuy.status === 'pending' || groupBuy.status === 'success') && !isExpired && (groupBuy.product?.stock ?? 1) > 0,
    end_time: groupBuy.end_time.toISOString(),
    pickup_time: groupBuy.pickup_time.toISOString(),
    product: groupBuy.product ? { product_id: groupBuy.product.id, name: groupBuy.product.name, cover_image: groupBuy.product.cover_image, price_cents: groupBuy.product.price_cents, sale_unit: groupBuy.product.sale_unit, sale_spec_name: groupBuy.product.sale_spec_name, stock: groupBuy.product.stock } : undefined
  };
}

export async function listUserProducts(query: ProductListQuery) {
  const { page, pageSize } = pageParams(query);
  const where: Prisma.ProductWhereInput = {
    status: 'active',
    ...(query.category_id ? { category_id: query.category_id } : {}),
    ...(query.keyword ? { name: { contains: query.keyword } } : {}),
    ...(booleanQuery(query.only_group_enabled) ? { is_group_enabled: true } : {}),
    ...(booleanQuery(query.only_in_stock) ? { stock: { gt: 0 } } : {})
  };
  const [total, products] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      include: {
        category: true,
        group_buys: { where: activeGroupBuyWhere(), select: { id: true, price_cents: true } }
      },
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize
    })
  ]);
  return {
    total,
    page,
    page_size: pageSize,
    items: products.map((product) => {
      const activeGroupBuyCount = product.group_buys.length;
      const groupPrices = product.group_buys.map((item) => item.price_cents);
      return {
        id: product.id,
        product_id: product.id,
        name: product.name,
        category_id: product.category_id,
        category_name: product.category.name,
        category: { id: product.category.id, name: product.category.name },
        cover_image: product.cover_image,
        price_cents: product.price_cents,
        unit: product.unit,
        stock_unit: product.stock_unit,
        sale_unit: product.sale_unit,
        sale_spec_name: product.sale_spec_name,
        stock: product.stock,
        display_stock: displayStock(product),
        is_group_enabled: product.is_group_enabled,
        has_active_group_buy: activeGroupBuyCount > 0,
        active_group_buy_count: activeGroupBuyCount,
        min_group_price_cents: groupPrices.length ? Math.min(...groupPrices) : null,
        status: product.status
      };
    })
  };
}

export async function getUserProductDetail(productId: string) {
  const product = await prisma.product.findFirst({
    where: { id: productId, status: 'active' },
    include: {
      category: true,
      group_buys: {
        where: groupBuyWhere(productId),
        include: { community: true, leader_user: true, product: true },
        orderBy: { end_time: 'asc' }
      }
    }
  });
  if (!product) throw Object.assign(new Error('商品不存在或已下架'), { statusCode: 404 });
  const activeGroupBuys = await Promise.all(product.group_buys.map(mapGroupBuy));
  return {
    id: product.id,
    product_id: product.id,
    name: product.name,
    category: { category_id: product.category_id, name: product.category.name },
    cover_image: product.cover_image,
    images: imagesOf(product.images),
    description: product.description,
    price_cents: product.price_cents,
    unit: product.unit,
    stock_unit: product.stock_unit,
    sale_unit: product.sale_unit,
    sale_spec_name: product.sale_spec_name,
    stock: product.stock,
    display_stock: displayStock(product),
    is_group_enabled: product.is_group_enabled,
    active_group_buys: activeGroupBuys,
    can_normal_buy: product.status === 'active' && product.stock > 0,
    can_join_group_buy: product.status === 'active' && product.is_group_enabled && product.stock > 0 && activeGroupBuys.length > 0
  };
}

export async function listUserProductGroupBuys(productId: string, query: GroupBuyListQuery) {
  const product = await prisma.product.findFirst({ where: { id: productId, status: 'active' }, select: { id: true } });
  if (!product) throw Object.assign(new Error('商品不存在或已下架'), { statusCode: 404 });
  const { page, pageSize } = pageParams(query);
  const where = groupBuyWhere(productId, query);
  const [total, groupBuys] = await Promise.all([
    prisma.groupBuy.count({ where }),
    prisma.groupBuy.findMany({ where, include: { community: true, leader_user: true, product: true }, orderBy: { end_time: 'asc' }, skip: (page - 1) * pageSize, take: pageSize })
  ]);
  return { total, page, page_size: pageSize, items: await Promise.all(groupBuys.map(mapGroupBuy)) };
}
