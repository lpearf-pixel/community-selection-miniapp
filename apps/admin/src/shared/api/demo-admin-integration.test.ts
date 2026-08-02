import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('local demo Admin request integration', () => {
  it('adds the demo token to legacy and modular Admin request paths', async () => {
    vi.stubEnv('VITE_ADMIN_TOKEN', 'local-demo-admin-token');
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ success: true, data: { ok: true }, message: '' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchImpl);

    const { adminFetch } = await import('../../api/adminRequest');
    const { adminJsonRequest } = await import('./admin-api');
    await adminFetch('/api/admin/legacy');
    await adminJsonRequest('/api/admin/modular');

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchImpl.mock.calls as [string, RequestInit][]) {
      expect(new Headers(init.headers).get('x-admin-token')).toBe(
        'local-demo-admin-token',
      );
    }
  });
});
