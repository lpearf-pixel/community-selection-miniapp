import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

interface CheckoutHarness extends Record<string, unknown> {
  data: Record<string, any>;
  setData(patch: Record<string, unknown>, callback?: () => void): void;
  submit(): Promise<void> | undefined;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function loadPage() {
  let definition: Record<string, unknown> | undefined;
  const order = deferred<{ id: string }>();
  const request = vi.fn(() => order.promise);
  const payOrder = vi.fn(async () => ({ pay_status: 'paid' }));
  const redirectTo = vi.fn();
  const source = fs.readFileSync(
    path.join(repoRoot, 'apps/miniapp/pages/orders/confirm/index.js'),
    'utf8',
  );
  vm.runInNewContext(source, {
    require: (requestPath: string) => {
      if (requestPath === '../../../utils/api') return {
        request,
        formatYuan: (cents: number) => (Number(cents || 0) / 100).toFixed(2),
      };
      if (requestPath === '../../../config') return { remoteDemo: false };
      if (requestPath === '../../../utils/payment') return { payOrder };
      if (requestPath === '../../../utils/user') return {
        getCurrentUser: () => ({ openid: 'buyer-1', nickname: '测试用户' }),
      };
      if (requestPath === '../../../utils/selection') return {
        getSelectedCommunity: () => null,
        getSelectedPickupStore: () => null,
      };
      if (requestPath === '../../../utils/cart') return { removeCartItem: vi.fn() };
      throw new Error(`unexpected require ${requestPath}`);
    },
    Page: (value: Record<string, unknown>) => { definition = value; },
    wx: { redirectTo, showToast: vi.fn() },
  });
  if (!definition) throw new Error('Page definition was not registered');
  const page = {
    ...definition,
    data: {
      ...(definition.data as Record<string, unknown>),
      type: 'normal',
      product_id: 'product-1',
      quantity: 1,
      pickup_type: 'store',
      pickup_store_id: 'store-1',
      receiver_name: '测试用户',
      receiver_phone: '13800001001',
      product: { id: 'product-1', price_cents: 590, stock: 10 },
    },
    setData(this: CheckoutHarness, patch: Record<string, unknown>, callback?: () => void) {
      Object.assign(this.data, patch);
      callback?.();
    },
  } as unknown as CheckoutHarness;
  return { order, page, payOrder, redirectTo, request };
}

describe('checkout Mini Program page submit contract', () => {
  it('returns the order, runtime payment, and redirect completion chain', async () => {
    const { order, page, payOrder, redirectTo, request } = loadPage();

    const submission = page.submit();
    expect(typeof submission?.then).toBe('function');
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({
          user_id: expect.anything(),
          user_openid: expect.anything(),
        }),
      }),
    );

    order.resolve({ id: 'order-1' });
    await submission;

    expect(payOrder).toHaveBeenCalledWith('order-1');
    expect(redirectTo).toHaveBeenCalledWith({
      url: '/pages/orders/detail/index?id=order-1',
    });
  });
});
