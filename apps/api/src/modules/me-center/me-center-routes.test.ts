import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { assertLeaderRole } from '../../routes/leaders/center.js';

const openedApps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(openedApps.splice(0).map((app) => app.close()));
});

describe('L47 center routes', () => {
  it('registers both center endpoints and returns 401 without user identity', async () => {
    const app = buildApp();
    openedApps.push(app);
    await app.ready();

    const meResponse = await app.inject({
      method: 'GET',
      url: '/api/me/center-summary',
    });
    const leaderResponse = await app.inject({
      method: 'GET',
      url: '/api/leaders/me/center-summary',
    });

    expect(meResponse.statusCode).toBe(401);
    expect(leaderResponse.statusCode).toBe(401);
    expect(meResponse.json()).toMatchObject({ success: false });
    expect(leaderResponse.json()).toMatchObject({ success: false });
  });

  it('rejects non-leaders with 403 and accepts leaders', () => {
    expect(() => assertLeaderRole('customer')).toThrowError('仅开团人可访问团长中心');

    try {
      assertLeaderRole('customer');
    } catch (error) {
      expect((error as { statusCode?: number }).statusCode).toBe(403);
    }

    expect(() => assertLeaderRole('leader')).not.toThrow();
  });
});
