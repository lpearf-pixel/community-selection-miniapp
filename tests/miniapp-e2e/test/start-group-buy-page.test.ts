import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

interface RequestCall {
  url: string;
  method?: string;
  data?: Record<string, unknown>;
  success?: (response: unknown) => void;
  fail?: (error: unknown) => void;
  complete?: () => void;
}

interface PageHarness extends Record<string, unknown> {
  data: Record<string, unknown>;
  setData(patch: Record<string, unknown>): void;
  loadOptions(): void;
  submit(): Promise<void> | undefined;
}

function loadPage() {
  const requests: RequestCall[] = [];
  let definition: Record<string, unknown> | undefined;
  const source = fs.readFileSync(
    path.join(repoRoot, 'apps/miniapp/pages/start-group-buy/index.js'),
    'utf8',
  );
  const navigateTo = vi.fn();
  vm.runInNewContext(source, {
    Date,
    require: (request: string) => {
      if (request === '../../utils/api') return { getApiBaseUrl: () => 'http://api.test' };
      if (request === '../../utils/user') return {
        getCurrentUser: () => ({ openid: 'leader-1' }),
      };
      throw new Error(`unexpected require ${request}`);
    },
    Page: (value: Record<string, unknown>) => { definition = value; },
    wx: {
      request: (options: RequestCall) => requests.push(options),
      showToast: vi.fn(),
      navigateTo,
    },
  });
  if (!definition) throw new Error('Page definition was not registered');
  const page = {
    ...definition,
    data: { ...(definition.data as Record<string, unknown>) },
    setData(patch: Record<string, unknown>) {
      Object.assign(this.data, patch);
    },
  } as PageHarness;
  return { navigateTo, page, requests };
}

describe('start group-buy Mini Program page', () => {
  it('unwraps paginated options and awaits canonical group creation', async () => {
    const { navigateTo, page, requests } = loadPage();

    page.loadOptions();
    expect(requests).toHaveLength(2);
    requests[0].success?.({
      data: { success: true, data: { items: [
        { product_id: 'product-1', name: '测试蔬菜', is_group_enabled: true },
      ] } },
    });
    requests[1].success?.({
      data: { success: true, data: { total: 553, page: 1, page_size: 50, items: [
        { community_id: 'community-1', name: '测试社区' },
      ] } },
    });

    expect(page.data.products).toEqual([
      expect.objectContaining({ id: 'product-1', product_id: 'product-1' }),
    ]);
    expect(page.data.communities).toEqual([
      expect.objectContaining({ id: 'community-1', community_id: 'community-1' }),
    ]);

    const submission = page.submit();
    expect(typeof submission?.then).toBe('function');
    expect(requests[2]).toMatchObject({
      url: 'http://api.test/api/group-buys',
      method: 'POST',
      data: {
        product_id: 'product-1',
        community_id: 'community-1',
        leader_openid: 'leader-1',
      },
    });
    requests[2].success?.({ data: { success: true, data: { id: 'group-1' } } });
    requests[2].complete?.();
    await submission;
    expect(navigateTo).toHaveBeenCalledWith({
      url: '/pages/group-buy-detail/index?id=group-1',
    });
  });

  it('uses the seeded leader identity required by the API role check', () => {
    const scenario = fs.readFileSync(
      path.join(repoRoot, 'tests/miniapp-e2e/src/scenarios/group-buy.ts'),
      'utf8',
    );
    expect(scenario).toContain("'leader-openid'");
    expect(scenario).toContain('{ trackOrders: false }');
    expect(scenario).not.toContain('miniapp-business-group-leader-');
  });
});
