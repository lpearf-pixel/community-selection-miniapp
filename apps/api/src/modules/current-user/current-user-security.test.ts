import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CURRENT_USER_SELECT,
  mapCurrentUserRouteError,
  publicCurrentUserError,
  requireCurrentLeader,
  resolveCurrentUser,
  safeErrorLogMetadata,
} from './current-user-security.js';

const findUnique = vi.fn();
const fakeClient = {
  user: {
    findUnique,
  },
} as any;

const activeCustomer = {
  id: 'user-a',
  openid: 'openid-a',
  role: 'customer',
  status: 'active',
  nickname: 'Customer A',
  avatar_url: null,
};

beforeEach(() => {
  findUnique.mockReset();
});

describe('current-user security core', () => {
  it('rejects missing or query-only identity inputs with 401', async () => {
    await expect(resolveCurrentUser({}, fakeClient)).rejects.toMatchObject({
      statusCode: 401,
      message: '缺少用户身份',
    });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('uses x-user-id before x-openid when both exist', async () => {
    findUnique.mockResolvedValue(activeCustomer);

    const user = await resolveCurrentUser(
      { 'x-user-id': ' user-a ', 'x-openid': 'openid-b' },
      fakeClient,
    );

    expect(user.id).toBe('user-a');
    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'user-a' },
      select: CURRENT_USER_SELECT,
    });
  });

  it('does not fall back to x-openid when a higher-priority x-user-id is unknown', async () => {
    findUnique.mockResolvedValue(null);

    await expect(
      resolveCurrentUser(
        { 'x-user-id': 'unknown-user', 'x-openid': 'known-openid' },
        fakeClient,
      ),
    ).rejects.toMatchObject({ statusCode: 404, message: '用户不存在' });

    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'unknown-user' },
      select: CURRENT_USER_SELECT,
    });
  });

  it('resolves x-openid when x-user-id is absent', async () => {
    findUnique.mockResolvedValue(activeCustomer);

    const user = await resolveCurrentUser({ 'x-openid': [' ', 'openid-a'] }, fakeClient);

    expect(user.id).toBe('user-a');
    expect(findUnique).toHaveBeenCalledWith({
      where: { openid: 'openid-a' },
      select: CURRENT_USER_SELECT,
    });
  });

  it('rejects inactive users with 403', async () => {
    findUnique.mockResolvedValue({ ...activeCustomer, status: 'inactive' });

    await expect(
      resolveCurrentUser({ 'x-user-id': 'user-a' }, fakeClient),
    ).rejects.toMatchObject({ statusCode: 403, message: '用户状态不可用' });
  });

  it('requires leader role', () => {
    expect(() => requireCurrentLeader(activeCustomer as any)).toThrowError('仅开团人可访问');

    try {
      requireCurrentLeader(activeCustomer as any);
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 403 });
    }

    expect(() =>
      requireCurrentLeader({ ...activeCustomer, role: 'leader' } as any),
    ).not.toThrow();
  });

  it('preserves only explicit public 4xx errors', () => {
    expect(
      mapCurrentUserRouteError(publicCurrentUserError('输入不合法', 400), '操作失败'),
    ).toEqual({ statusCode: 400, message: '输入不合法' });

    expect(
      mapCurrentUserRouteError(
        Object.assign(new Error('伪造公开错误'), { statusCode: 400 }),
        '操作失败',
      ),
    ).toEqual({ statusCode: 500, message: '操作失败' });
  });

  it('maps unknown errors to fixed 500 without exposing the message', () => {
    expect(
      mapCurrentUserRouteError(new Error('database-host-secret'), '操作失败'),
    ).toEqual({
      statusCode: 500,
      message: '操作失败',
    });

    expect(
      mapCurrentUserRouteError(publicCurrentUserError('invalid-public-status', 500), '操作失败'),
    ).toEqual({ statusCode: 500, message: '操作失败' });
  });

  it('returns safe error log metadata without message or stack', () => {
    const error = Object.assign(new Error('database-host-secret'), {
      code: 'P1001',
      stack: 'secret-stack',
    });

    const metadata = safeErrorLogMetadata('resolve-user', error);

    expect(metadata).toEqual({
      operation: 'resolve-user',
      error_name: 'Error',
      error_code: 'P1001',
    });
    expect(Object.keys(metadata).sort()).toEqual([
      'error_code',
      'error_name',
      'operation',
    ]);
    expect(JSON.stringify(metadata)).not.toContain('database-host-secret');
    expect(JSON.stringify(metadata)).not.toContain('secret-stack');
  });
});
