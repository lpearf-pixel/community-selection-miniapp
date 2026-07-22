import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest';
import {
  JsonLineReporter,
  runScenarioLifecycle,
  withTimeout,
  type MiniProgramSession,
} from '@community-selection/miniapp-testkit';
import { makeRunId, resolveProjectE2eConfig } from '../src/config.js';
import { FixtureApi } from '../src/fixture-api.js';
import {
  captureProjectFailure,
  openProjectSession,
  probeSourceContract,
  writeProjectReport,
} from '../src/project-session.js';
import { ScenarioContext, type StorageSnapshot } from '../src/scenario-context.js';
import { runGroupBuy } from '../src/scenarios/group-buy.js';
import { runOrdinaryDelivery } from '../src/scenarios/ordinary-delivery.js';
import { runOrdinaryPickupRefund } from '../src/scenarios/ordinary-pickup-refund.js';

// Real WeChat payment is not covered. The suite requires the API's MOCK_WECHAT_PAY mode.
describe.sequential('Community Selection Mini Program business E2E', () => {
  const passed = new Set<string>();
  let session: MiniProgramSession;
  let context: ScenarioContext;
  let storage: StorageSnapshot;
  let reporter: JsonLineReporter;

  beforeAll(async () => {
    expect(process.env.MOCK_WECHAT_PAY ?? 'true', 'MOCK_WECHAT_PAY must not be false')
      .not.toBe('false');
    const config = resolveProjectE2eConfig();
    const runId = makeRunId();
    reporter = new JsonLineReporter({ runId, outputDir: config.outputDir });
    session = await openProjectSession(config, reporter);
    await probeSourceContract(session, config.operationTimeoutMs);
    const fixture = await new FixtureApi(config.apiBaseUrl).loadBusinessFixture();
    context = new ScenarioContext(config, session, reporter, runId, fixture);
    storage = await context.captureStorage();
    await context.configureProjectStorage();
    reporter.step('fixtures-ready', {
      productId: fixture.product.product_id,
      communityId: fixture.community.community_id,
      pickupStoreId: fixture.pickupStore.pickup_store_id,
    });
  });

  afterEach(async (testContext) => {
    if (testContext.task.result?.state === 'fail') {
      await captureProjectFailure(session, reporter, context.config.operationTimeoutMs);
    }
  });

  afterAll(async () => {
    if (!context || !session) return;
    let cleanupError: unknown;
    try {
      await runScenarioLifecycle({
        run: async () => undefined,
        cleanups: [
          async () => {
            try {
              await withTimeout(() => session.close(), {
                label: 'close Mini Program session',
                timeoutMs: context.config.operationTimeoutMs,
              });
            } catch (error) {
              session.disconnect();
              throw error;
            }
          },
          async () => context.restoreStorage(storage),
          async () => context.cleanupOrders(),
        ],
        onCleanupError: (error) => reporter.step('cleanup-error', { message: error.message }),
      });
    } catch (error) {
      cleanupError = error;
    } finally {
      const report = writeProjectReport(reporter);
      process.stdout.write(`miniapp_business_report=${report}\n`);
    }
    if (cleanupError) throw cleanupError;
    if (passed.size === 3) process.stdout.write('miniapp_business_e2e_exit=0\n');
  });

  it('ordinary store pickup and after-sale refund', async () => {
    await runOrdinaryPickupRefund(context);
    passed.add('pickup-refund');
    process.stdout.write('ordinary_purchase_flow=passed\n');
  });

  it('ordinary delivery and fulfillment', async () => {
    await runOrdinaryDelivery(context);
    passed.add('delivery');
    process.stdout.write('ordinary_delivery_flow=passed\n');
  });

  it('two-participant group buy and fulfillment', async () => {
    await runGroupBuy(context);
    passed.add('group-buy');
    process.stdout.write('group_buy_flow=passed\n');
  });
});
