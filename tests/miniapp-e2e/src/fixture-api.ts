export const STORE_SEQUENCE = Object.freeze(['preparing', 'ready', 'picked', 'completed']);
export const DELIVERY_SEQUENCE = Object.freeze(['preparing', 'ready', 'delivered', 'completed']);

export interface ProductFixture {
  id: string;
  product_id: string;
  name: string;
  stock?: number;
  status?: string;
  is_group_enabled?: boolean;
  [key: string]: unknown;
}

export interface CommunityFixture {
  id: string;
  community_id: string;
  name?: string;
  [key: string]: unknown;
}

export interface PickupStoreFixture {
  id: string;
  pickup_store_id: string;
  community_id?: string | null;
  name?: string;
  [key: string]: unknown;
}

export interface BusinessFixture {
  product: ProductFixture;
  community: CommunityFixture;
  pickupStore: PickupStoreFixture;
}

export interface OrderReference {
  id: string;
  openid: string;
}

export interface OrderRecord {
  id: string;
  pay_status?: string;
  order_status?: string;
  refund_status?: string;
  pay_amount_cents?: number;
  refund_amount_cents?: number;
  [key: string]: unknown;
}

export interface GroupBuyRecord {
  id?: string;
  group_buy_id?: string;
  status?: string;
  paid_quantity?: number;
  current_quantity?: number;
  target_count?: number;
  min_quantity?: number;
  [key: string]: unknown;
}

export class FixtureApiError extends Error {
  readonly status: number;
  readonly pathname: string;

  constructor(message: string, options: { status: number; pathname: string; cause?: unknown }) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'FixtureApiError';
    this.status = options.status;
    this.pathname = options.pathname;
  }
}

function asItems(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  if (value && typeof value === 'object' && Array.isArray((value as { items?: unknown[] }).items)) {
    return (value as { items: Record<string, unknown>[] }).items;
  }
  return [];
}

function normalizeProduct(value: Record<string, unknown>): ProductFixture {
  const id = String(value.product_id ?? value.id ?? '');
  return { ...value, id, product_id: id, name: String(value.name ?? '') } as ProductFixture;
}

function normalizeCommunity(value: Record<string, unknown>): CommunityFixture {
  const id = String(value.community_id ?? value.id ?? '');
  return { ...value, id, community_id: id } as CommunityFixture;
}

function normalizePickupStore(value: Record<string, unknown>): PickupStoreFixture {
  const id = String(value.pickup_store_id ?? value.id ?? '');
  return { ...value, id, pickup_store_id: id } as PickupStoreFixture;
}

export function assertOrderState(
  order: Record<string, unknown> | null | undefined,
  expected: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(expected)) {
    if (order?.[key] !== value) {
      throw new Error(`expected ${key}=${String(value)}, received ${String(order?.[key])}`);
    }
  }
}

export function assertGroupSucceeded(groupBuy: GroupBuyRecord | null | undefined): void {
  if (groupBuy?.status !== 'success') {
    throw new Error(`expected group status=success, received ${String(groupBuy?.status)}`);
  }
  const paidQuantity = Number(groupBuy.paid_quantity ?? groupBuy.current_quantity ?? 0);
  const targetCount = Number(groupBuy.target_count ?? groupBuy.min_quantity ?? 0);
  if (paidQuantity < targetCount) {
    throw new Error(`expected paid quantity ${paidQuantity} >= target ${targetCount}`);
  }
}

export class FixtureApi {
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(baseUrl: string, fetchImpl: typeof fetch = globalThis.fetch) {
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.fetchImpl = fetchImpl;
  }

  async request<T = unknown>(
    pathname: string,
    options: Omit<RequestInit, 'body'> & {
      body?: BodyInit | Record<string, unknown> | null;
    } = {},
  ): Promise<T> {
    const body = options.body && typeof options.body !== 'string'
      ? JSON.stringify(options.body)
      : options.body;
    const response = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
      ...options,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(options.headers ?? {}),
      },
      body,
    });
    let payload: { success?: boolean; data?: T; message?: string };
    try {
      payload = await response.json() as typeof payload;
    } catch (cause) {
      throw new FixtureApiError(`API ${pathname} returned invalid JSON (${response.status})`, {
        status: response.status,
        pathname,
        cause,
      });
    }
    if (!response.ok || payload.success !== true) {
      throw new FixtureApiError(payload.message || `API ${pathname} failed (${response.status})`, {
        status: response.status,
        pathname,
      });
    }
    return payload.data as T;
  }

  async loadBusinessFixture(): Promise<BusinessFixture> {
    const [productsPayload, communitiesPayload] = await Promise.all([
      this.request('/api/products?page_size=100&only_group_enabled=true&only_in_stock=true'),
      this.request('/api/communities'),
    ]);
    const product = asItems(productsPayload)
      .map(normalizeProduct)
      .find((item) => Number(item.stock) >= 4
        && item.status !== 'inactive'
        && item.is_group_enabled !== false);
    if (!product) throw new Error('No active in-stock group-enabled product fixture');

    for (const candidate of asItems(communitiesPayload).map(normalizeCommunity)) {
      const storesPayload = await this.request(
        `/api/pickup-stores?community_id=${encodeURIComponent(candidate.community_id)}&page_size=100`,
      );
      const stores = asItems(storesPayload).map(normalizePickupStore);
      const pickupStore = stores.find((store) => (
        !store.community_id || store.community_id === candidate.community_id
      ));
      if (pickupStore) return { product, community: candidate, pickupStore };
    }
    throw new Error('No active community with an active pickup-store fixture');
  }

  async discoverUserOrders(
    createdOrders: OrderReference[],
    userOpenids: string[],
  ): Promise<OrderReference[]> {
    const references = new Map<string, OrderReference>();
    const add = (reference: OrderReference) => {
      if (reference?.id && reference.openid) {
        references.set(`${reference.openid}:${reference.id}`, reference);
      }
    };
    createdOrders.forEach(add);

    for (const openid of userOpenids) {
      try {
        const payload = await this.request('/api/me/orders?page_size=100', {
          headers: { 'x-openid': openid },
        });
        for (const order of asItems(payload)) {
          const id = String(order.order_id ?? order.id ?? '').trim();
          if (id) add({ id, openid });
        }
      } catch (error) {
        if (error instanceof FixtureApiError && error.status === 404) continue;
        throw error;
      }
    }
    return [...references.values()];
  }

  async getUserOrder(orderId: string, openid: string): Promise<OrderRecord> {
    if (!openid) throw new Error(`Order ${orderId} requires a user OpenID`);
    const order = await this.request<Record<string, unknown>>(
      `/api/me/orders/${encodeURIComponent(orderId)}`,
      {
        headers: { 'x-openid': openid },
      },
    );
    const id = String(order.order_id ?? order.id ?? '').trim();
    if (!id) throw new Error(`Order ${orderId} response is missing an identifier`);
    return { ...order, id } as OrderRecord;
  }

  async advanceOrder(
    orderId: string,
    sequence: readonly string[],
    openid: string,
    onStep: (event: string, details: Record<string, unknown>) => void = () => undefined,
  ): Promise<OrderRecord> {
    let current: OrderRecord = { id: orderId };
    for (const nextStatus of sequence) {
      const pickupVerification = nextStatus === 'picked';
      const pathname = pickupVerification
        ? `/api/admin/orders/${encodeURIComponent(orderId)}/pickup-verify`
        : `/api/orders/${encodeURIComponent(orderId)}/status`;
      await this.request(pathname, {
        method: 'POST',
        body: pickupVerification
          ? { admin_remark: '微信点击闭环测试核销' }
          : { next_status: nextStatus },
      });
      current = await this.getUserOrder(orderId, openid);
      assertOrderState(current, { pay_status: 'paid', order_status: nextStatus });
      onStep('order-status-passed', { orderId, nextStatus });
    }
    return current;
  }

  async createFullMockRefund(order: OrderRecord, runId: string): Promise<unknown> {
    const refundable = Math.max(
      0,
      Number(order.pay_amount_cents ?? 0) - Number(order.refund_amount_cents ?? 0),
    );
    if (!refundable) throw new Error(`Order ${order.id} has no refundable balance`);
    return this.request('/api/refunds/mock', {
      method: 'POST',
      body: {
        order_id: order.id,
        refund_amount_cents: refundable,
        reason: '微信点击闭环测试退款',
        client_refund_id: `miniapp-business-${runId}-${order.id}`,
      },
    });
  }

  async getGroupBuy(groupBuyId: string): Promise<GroupBuyRecord> {
    return this.request(`/api/group-buys/${encodeURIComponent(groupBuyId)}`);
  }
}
