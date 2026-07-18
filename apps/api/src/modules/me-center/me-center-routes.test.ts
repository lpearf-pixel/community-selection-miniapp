import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../app.js';
import { prisma } from '../../db.js';
import { assertLeaderRole } from '../../routes/leaders/center.js';

const openedApps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
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

  it('rejects query-only identities for both center endpoints', async () => {
    const app = buildApp();
    openedApps.push(app);
    await app.ready();

    const meResponse = await app.inject({
      method: 'GET',
      url: '/api/me/center-summary?user_id=l47-query-only-user',
    });
    const leaderResponse = await app.inject({
      method: 'GET',
      url: '/api/leaders/me/center-summary?openid=l47-query-only-openid',
    });

    expect(meResponse.statusCode).toBe(401);
    expect(leaderResponse.statusCode).toBe(401);
    expect(meResponse.json()).toMatchObject({ success: false, message: '缺少用户身份' });
    expect(leaderResponse.json()).toMatchObject({ success: false, message: '缺少用户身份' });
  });

  it('sanitizes unexpected personal-center failures as HTTP 500', async () => {
    vi.spyOn(prisma.user, 'findUnique').mockRejectedValueOnce(
      new Error('Prisma connection failed at secret-host'),
    );
    const app = buildApp();
    openedApps.push(app);
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/api/me/center-summary',
      headers: { 'x-user-id': 'l47-error-user' },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ success: false, message: '个人中心加载失败' });
    expect(response.body).not.toContain('Prisma');
    expect(response.body).not.toContain('secret-host');
  });

  it('sanitizes unexpected leader-center failures as HTTP 500', async () => {
    vi.spyOn(prisma.user, 'findUnique').mockRejectedValueOnce(
      new Error('Prisma connection failed at secret-host'),
    );
    const app = buildApp();
    openedApps.push(app);
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/api/leaders/me/center-summary',
      headers: { 'x-user-id': 'l47-error-leader' },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ success: false, message: '团长中心加载失败' });
    expect(response.body).not.toContain('Prisma');
    expect(response.body).not.toContain('secret-host');
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
