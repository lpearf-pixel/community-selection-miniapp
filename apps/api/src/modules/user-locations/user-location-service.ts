import { Prisma } from '@prisma/client';
import { prisma } from '../../db.js';

type LocationQuery = { keyword?: string; community_id?: string; page?: string | number; page_size?: string | number };

function pageOf(query: LocationQuery) { return Math.max(1, Number(query.page ?? 1) || 1); }
function pageSizeOf(query: LocationQuery) { return Math.min(100, Math.max(1, Number(query.page_size ?? 50) || 50)); }
function keywordWhere(keyword?: string) { const value = keyword?.trim(); return value ? { OR: [{ name: { contains: value, mode: Prisma.QueryMode.insensitive } }, { address: { contains: value, mode: Prisma.QueryMode.insensitive } }] } : undefined; }

export async function listActiveCommunities(query: LocationQuery) {
  const page = pageOf(query); const pageSize = pageSizeOf(query);
  const where: Prisma.CommunityWhereInput = { status: 'active', ...keywordWhere(query.keyword) };
  const [total, items] = await Promise.all([
    prisma.community.count({ where }),
    prisma.community.findMany({ where, orderBy: { created_at: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, select: { id: true, name: true, address: true, status: true } })
  ]);
  return { total, page, page_size: pageSize, items: items.map((item) => ({ community_id: item.id, name: item.name, address: item.address, status: item.status })) };
}

export async function listActivePickupStores(query: LocationQuery) {
  const page = pageOf(query); const pageSize = pageSizeOf(query);
  const where: Prisma.PickupStoreWhereInput = { status: 'active', ...keywordWhere(query.keyword) };
  const [total, items] = await Promise.all([
    prisma.pickupStore.count({ where }),
    prisma.pickupStore.findMany({ where, orderBy: { created_at: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, select: { id: true, name: true, address: true, phone: true, status: true } })
  ]);
  return { total, page, page_size: pageSize, items: items.map(mapPickupStore) };
}

export async function getActivePickupStore(id: string) {
  const store = await prisma.pickupStore.findFirst({ where: { id, status: 'active' }, select: { id: true, name: true, address: true, phone: true, status: true } });
  if (!store) throw Object.assign(new Error('自提点不存在'), { statusCode: 404 });
  return mapPickupStore(store);
}

function mapPickupStore(store: { id: string; name: string; address: string; phone: string | null; status: string }) {
  return { pickup_store_id: store.id, name: store.name, address: store.address, phone: store.phone, community_id: null, community_name: null, status: store.status };
}
