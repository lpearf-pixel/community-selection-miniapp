import { describe, expect, it, vi } from 'vitest';
import { JsonLineReporter, type MiniProgramSession } from '@community-selection/miniapp-testkit';
import type { ProjectE2eConfig } from '../src/config.js';
import type { BusinessFixture } from '../src/fixture-api.js';
import { ScenarioContext } from '../src/scenario-context.js';

function createContext() {
  const storage = new Map<string, unknown>([
    ['API_BASE_URL', 'https://before.example'],
    ['community_selection_user', { openid: 'before-user' }],
    ['selected_community', { id: 'before-community' }],
    ['selected_pickup_store', { id: 'before-store' }],
  ]);
  const callWxMethod = vi.fn(async (method: string, key: unknown, value?: unknown) => {
    const storageKey = String(key);
    if (method === 'getStorageSync') return storage.get(storageKey);
    if (method === 'setStorageSync') storage.set(storageKey, value);
    if (method === 'removeStorageSync') storage.delete(storageKey);
    return undefined;
  });
  const page = { path: 'pages/index/index' };
  const session: MiniProgramSession = {
    currentPage: vi.fn(async () => page),
    reLaunch: vi.fn(async () => page),
    callWxMethod,
    screenshot: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    disconnect: vi.fn(),
  };
  const config: ProjectE2eConfig = {
    repoRoot: '/repo',
    apiBaseUrl: 'http://127.0.0.1:13080',
    cliPath: '/cli',
    projectPath: '/repo/apps/miniapp',
    port: 9420,
    launchTimeoutMs: 60_000,
    operationTimeoutMs: 10_000,
    outputDir: '/tmp',
    keepData: false,
  };
  const fixture: BusinessFixture = {
    product: { id: 'p1', product_id: 'p1', name: '青菜' },
    community: { id: 'c1', community_id: 'c1', name: '社区' },
    pickupStore: { id: 's1', pickup_store_id: 's1', community_id: 'c1' },
  };
  const context = new ScenarioContext(
    config,
    session,
    new JsonLineReporter({ runId: 'storage', write: () => undefined }),
    'run-1',
    fixture,
  );
  return { callWxMethod, context, storage };
}

describe('ScenarioContext storage isolation', () => {
  it('restores API, user, community, and pickup-store values after a run', async () => {
    const { context, storage } = createContext();
    const snapshot = await context.captureStorage();
    await context.configureProjectStorage();
    await context.setUser('new-user', '新用户', '13800000001');
    await context.restoreStorage(snapshot);

    expect(Object.fromEntries(storage)).toEqual({
      API_BASE_URL: 'https://before.example',
      community_selection_user: { openid: 'before-user' },
      selected_community: { id: 'before-community' },
      selected_pickup_store: { id: 'before-store' },
    });
  });

  it('uses unique active user storage and tracks it for cleanup', async () => {
    const { callWxMethod, context } = createContext();
    await context.setUser('participant-a', '参团A', '13800002001');

    expect(context.testOpenids).toContain('participant-a');
    expect(callWxMethod).toHaveBeenCalledWith(
      'setStorageSync',
      'community_selection_user',
      expect.objectContaining({ openid: 'participant-a', receiver_name: '参团A' }),
    );
  });

  it('switches to a shared leader identity without widening cleanup discovery', async () => {
    const { context } = createContext();

    await context.setUser(
      'leader-openid',
      '测试开团人',
      '13800000001',
      { trackOrders: false },
    );

    expect(context.testOpenids).not.toContain('leader-openid');
  });
});
