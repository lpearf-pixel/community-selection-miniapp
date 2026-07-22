import {
  JsonLineReporter,
  MiniappDriver,
  type MiniProgramSession,
} from '@community-selection/miniapp-testkit';
import type { ProjectE2eConfig } from './config.js';
import {
  FixtureApi,
  assertOrderState,
  type BusinessFixture,
  type OrderRecord,
  type OrderReference,
} from './fixture-api.js';
import { AfterSalesPage } from './pages/after-sales.page.js';
import { CheckoutPage } from './pages/checkout.page.js';
import { GroupBuyDetailPage, GroupOrderPage, StartGroupBuyPage } from './pages/group.page.js';
import { OrderDetailPage } from './pages/order-detail.page.js';
import { ProductsPage } from './pages/products.page.js';

const STORAGE_KEYS = [
  'API_BASE_URL',
  'community_selection_user',
  'selected_community',
  'selected_pickup_store',
] as const;

export type StorageSnapshot = Record<(typeof STORAGE_KEYS)[number], unknown>;

export class ScenarioContext {
  readonly driver: MiniappDriver;
  readonly api: FixtureApi;
  readonly createdOrders: OrderReference[] = [];
  readonly testOpenids = new Set<string>();
  readonly pages: {
    products: ProductsPage;
    checkout: CheckoutPage;
    orderDetail: OrderDetailPage;
    afterSales: AfterSalesPage;
    startGroup: StartGroupBuyPage;
    groupDetail: GroupBuyDetailPage;
    groupOrder: GroupOrderPage;
  };

  constructor(
    readonly config: ProjectE2eConfig,
    readonly session: MiniProgramSession,
    readonly reporter: JsonLineReporter,
    readonly runId: string,
    readonly fixture: BusinessFixture,
  ) {
    this.driver = new MiniappDriver({
      session,
      reporter,
      operationTimeoutMs: config.operationTimeoutMs,
    });
    this.api = new FixtureApi(config.apiBaseUrl);
    this.pages = {
      products: new ProductsPage(this.driver),
      checkout: new CheckoutPage(this.driver),
      orderDetail: new OrderDetailPage(this.driver),
      afterSales: new AfterSalesPage(this.driver),
      startGroup: new StartGroupBuyPage(this.driver),
      groupDetail: new GroupBuyDetailPage(this.driver),
      groupOrder: new GroupOrderPage(this.driver),
    };
  }

  async captureStorage(): Promise<StorageSnapshot> {
    const snapshot = {} as StorageSnapshot;
    for (const key of STORAGE_KEYS) {
      snapshot[key] = await this.session.callWxMethod('getStorageSync', key);
    }
    return snapshot;
  }

  async configureProjectStorage(): Promise<void> {
    await this.session.callWxMethod('setStorageSync', 'API_BASE_URL', this.config.apiBaseUrl);
    await this.setLocation();
  }

  async restoreStorage(snapshot: StorageSnapshot): Promise<void> {
    for (const key of STORAGE_KEYS) {
      const value = snapshot[key];
      if (value === undefined || value === null || value === '') {
        await this.session.callWxMethod('removeStorageSync', key);
      } else {
        await this.session.callWxMethod('setStorageSync', key, value);
      }
    }
  }

  async setLocation(): Promise<void> {
    await this.session.callWxMethod('setStorageSync', 'selected_community', this.fixture.community);
    await this.session.callWxMethod('setStorageSync', 'selected_pickup_store', this.fixture.pickupStore);
  }

  async setUser(openid: string, name: string, phone: string): Promise<void> {
    this.testOpenids.add(openid);
    await this.session.callWxMethod('setStorageSync', 'community_selection_user', {
      user_id: '',
      openid,
      nickname: name,
      receiver_name: name,
      receiver_phone: phone,
    });
    await this.setLocation();
  }

  trackOrder(order: OrderRecord, openid: string): void {
    this.createdOrders.push({ id: order.id, openid });
    this.reporter.step('order-tracked', { orderId: order.id, openid });
  }

  async waitForGroup(groupBuyId: string, predicate: (group: Record<string, unknown>) => boolean) {
    const deadline = Date.now() + 20_000;
    let group = await this.api.getGroupBuy(groupBuyId);
    while (!predicate(group) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      group = await this.api.getGroupBuy(groupBuyId);
    }
    if (!predicate(group)) throw new Error(`Timed out waiting for group ${groupBuyId}`);
    return group;
  }

  async cleanupOrders(): Promise<void> {
    if (this.config.keepData) {
      this.reporter.step('cleanup-skipped', { reason: 'MINIAPP_E2E_KEEP_DATA' });
      return;
    }
    const references = await this.api.discoverUserOrders(
      this.createdOrders,
      [...this.testOpenids],
    );
    const failures: string[] = [];
    for (const reference of references) {
      try {
        const order = await this.api.getUserOrder(reference.id, reference.openid);
        const refundable = Number(order.pay_amount_cents ?? 0) - Number(order.refund_amount_cents ?? 0);
        if (order.pay_status === 'paid' && refundable > 0 && order.order_status !== 'closed') {
          await this.api.createFullMockRefund(order, `${this.runId}-cleanup`);
          const cleaned = await this.api.getUserOrder(reference.id, reference.openid);
          assertOrderState(cleaned, { order_status: 'refunded', refund_status: 'success' });
          this.reporter.step('cleanup-order-refunded', { orderId: reference.id });
        }
      } catch (error) {
        failures.push(`${reference.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (failures.length) throw new Error(`Business fixture cleanup failed: ${failures.join('; ')}`);
  }
}
