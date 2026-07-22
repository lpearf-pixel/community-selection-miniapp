'use strict';

const assert = require('node:assert/strict');

const STORE_SEQUENCE = Object.freeze(['preparing', 'ready', 'picked', 'completed']);
const DELIVERY_SEQUENCE = Object.freeze(['preparing', 'ready', 'delivered', 'completed']);

function asList(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value && value.items)) return value.items;
  return [];
}

async function apiRequest(apiBaseUrl, pathname, options = {}, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(`${String(apiBaseUrl).replace(/\/+$/, '')}${pathname}`, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
    body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body,
  });
  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error(`API ${pathname} returned invalid JSON (${response.status})`);
  }
  if (!response.ok || payload.success !== true) {
    throw Object.assign(
      new Error(payload.message || `API ${pathname} failed (${response.status})`),
      { status: response.status, pathname },
    );
  }
  return payload.data;
}

function normalizeCommunity(community) {
  const id = community.community_id || community.id;
  return { ...community, id, community_id: id };
}

function normalizePickupStore(store) {
  const id = store.pickup_store_id || store.id;
  return { ...store, id, pickup_store_id: id };
}

function normalizeProduct(product) {
  const id = product.product_id || product.id;
  return { ...product, id, product_id: id };
}

function selectBusinessFixtures(productsPayload, communitiesPayload, pickupStoresPayload) {
  const products = asList(productsPayload).map(normalizeProduct);
  const communities = asList(communitiesPayload).map(normalizeCommunity);
  const pickupStores = asList(pickupStoresPayload).map(normalizePickupStore);
  const product = products.find((item) => Number(item.stock) >= 4 && item.is_group_enabled !== false && item.status !== 'inactive');
  if (!product) throw new Error('No active in-stock group-enabled product fixture');
  if (!communities[0]) throw new Error('No active community fixture');
  if (!pickupStores[0]) throw new Error('No active pickup-store fixture');
  let community;
  let pickupStore;
  for (const candidateCommunity of communities) {
    const candidateStore = pickupStores.find((store) => {
      const communityId = store.community_id || (store.community && (store.community.community_id || store.community.id));
      return communityId && communityId === candidateCommunity.community_id;
    });
    if (candidateStore) {
      community = candidateCommunity;
      pickupStore = candidateStore;
      break;
    }
  }
  if (!pickupStore) {
    pickupStore = pickupStores.find((store) => !store.community_id) || pickupStores[0];
    community = communities[0];
  }
  return { product, community, pickupStore };
}

function assertOrderState(order, expected) {
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(order && order[key], value, `expected ${key}=${value}, received ${order && order[key]}`);
  }
  return order;
}

function assertGroupSucceeded(groupBuy) {
  assert.equal(groupBuy && groupBuy.status, 'success', `expected group status=success, received ${groupBuy && groupBuy.status}`);
  const paidQuantity = Number(groupBuy.paid_quantity ?? groupBuy.current_quantity ?? 0);
  const targetCount = Number(groupBuy.target_count ?? groupBuy.min_quantity ?? 0);
  assert.ok(paidQuantity >= targetCount, `expected paid quantity ${paidQuantity} >= target ${targetCount}`);
  return groupBuy;
}

async function getUserOrder(apiBaseUrl, orderId, userOpenid, fetchImpl = globalThis.fetch) {
  if (!userOpenid) throw new Error(`Order ${orderId} requires a user OpenID for scoped verification`);
  return apiRequest(apiBaseUrl, `/api/me/orders/${encodeURIComponent(orderId)}`, {
    headers: { 'x-openid': userOpenid },
  }, fetchImpl);
}

async function discoverUserOrders(
  apiBaseUrl,
  createdOrders = [],
  userOpenids = [],
  fetchImpl = globalThis.fetch,
) {
  const references = new Map();
  const add = (reference) => {
    if (!reference || !reference.id || !reference.openid) return;
    references.set(`${reference.openid}:${reference.id}`, { id: reference.id, openid: reference.openid });
  };
  createdOrders.forEach(add);
  for (const openid of userOpenids) {
    let orders;
    try {
      orders = await apiRequest(apiBaseUrl, '/api/me/orders?page_size=100', {
        headers: { 'x-openid': openid },
      }, fetchImpl);
    } catch (error) {
      if (error && error.status === 404) continue;
      throw error;
    }
    for (const order of asList(orders)) add({ id: order.id, openid });
  }
  return [...references.values()];
}

async function advanceOrder(apiBaseUrl, orderId, sequence, userOpenid, record = () => {}, fetchImpl = globalThis.fetch) {
  let current;
  for (const nextStatus of sequence) {
    const isPickupVerification = nextStatus === 'picked';
    const actionPath = isPickupVerification
      ? `/api/admin/orders/${encodeURIComponent(orderId)}/pickup-verify`
      : `/api/orders/${encodeURIComponent(orderId)}/status`;
    await apiRequest(apiBaseUrl, actionPath, {
      method: 'POST',
      body: isPickupVerification
        ? { admin_remark: '微信点击闭环测试核销' }
        : { next_status: nextStatus },
    }, fetchImpl);
    current = await getUserOrder(apiBaseUrl, orderId, userOpenid, fetchImpl);
    assertOrderState(current, { pay_status: 'paid', order_status: nextStatus });
    record('order-status-passed', { orderId, nextStatus });
  }
  return current;
}

async function createFullMockRefund(apiBaseUrl, order, runId) {
  const refundAmount = Math.max(0, Number(order.pay_amount_cents || 0) - Number(order.refund_amount_cents || 0));
  if (!refundAmount) throw new Error(`Order ${order.id} has no refundable balance`);
  return apiRequest(apiBaseUrl, '/api/refunds/mock', {
    method: 'POST',
    body: {
      order_id: order.id,
      refund_amount_cents: refundAmount,
      reason: '微信点击闭环测试退款',
      client_refund_id: `miniapp-business-${runId}-${order.id}`,
    },
  });
}

async function waitUntil(load, predicate, description, options = {}) {
  const timeout = Number(options.timeout || 15000);
  const interval = Number(options.interval || 250);
  const deadline = Date.now() + timeout;
  let value;
  while (Date.now() < deadline) {
    value = await load();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error(`Timed out waiting for ${description}: ${JSON.stringify(value)}`);
}

function makeRunId(now = new Date()) {
  return now.toISOString().replace(/[^0-9]/g, '').slice(0, 17);
}

module.exports = {
  DELIVERY_SEQUENCE,
  STORE_SEQUENCE,
  advanceOrder,
  apiRequest,
  assertGroupSucceeded,
  assertOrderState,
  createFullMockRefund,
  discoverUserOrders,
  getUserOrder,
  makeRunId,
  normalizeCommunity,
  normalizePickupStore,
  selectBusinessFixtures,
  waitUntil,
};
