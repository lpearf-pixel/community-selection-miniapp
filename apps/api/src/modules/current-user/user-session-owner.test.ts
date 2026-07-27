import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createUserSessionOwner } from './user-session-owner.js';

const activeUser = {
  id: 'user-a',
  openid: 'openid-a',
  role: 'customer' as const,
  status: 'active',
  nickname: 'A',
  avatar_url: null,
};

describe('user session owner', () => {
  it('persists only a keyed digest and resolves an active Bearer token', async () => {
    const create = vi.fn(async (input) => ({
      ...input,
      id: 'session-a',
      revoked_at: null,
      user: activeUser,
    }));
    const findByTokenHash = vi.fn();
    const store = {
      create,
      findByTokenHash,
      revokeByTokenHash: vi.fn(),
      touchLastSeen: vi.fn(),
    };
    const owner = createUserSessionOwner({
      secret: 'session-secret-that-is-long-enough',
      store,
      now: () => new Date('2026-07-27T00:00:00.000Z'),
      randomBytes: () => Buffer.alloc(32, 7),
    });

    const issued = await owner.issue('user-a');
    const persisted = create.mock.calls[0]?.[0];
    expect(issued.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(persisted.token_hash).not.toBe(issued.token);
    expect(persisted.token_hash).toHaveLength(64);
    expect(JSON.stringify(persisted)).not.toContain(issued.token);

    findByTokenHash.mockResolvedValue({
      ...persisted,
      id: 'session-a',
      revoked_at: null,
      user: activeUser,
    });
    await expect(owner.resolve(issued.token)).resolves.toEqual(activeUser);
  });

  it('rejects expired, revoked, inactive, and unknown tokens', async () => {
    const findByTokenHash = vi.fn();
    const owner = createUserSessionOwner({
      secret: 'session-secret-that-is-long-enough',
      store: {
        create: vi.fn(),
        findByTokenHash,
        revokeByTokenHash: vi.fn(),
        touchLastSeen: vi.fn(),
      },
      now: () => new Date('2026-07-27T00:00:00.000Z'),
      randomBytes: () => Buffer.alloc(32, 1),
    });

    findByTokenHash.mockResolvedValueOnce(null);
    await expect(owner.resolve('unknown')).rejects.toMatchObject({
      statusCode: 401,
    });
    findByTokenHash.mockResolvedValueOnce({
      token_hash: createHash('sha256').update('unused').digest('hex'),
      expires_at: new Date('2026-07-26T23:59:59.000Z'),
      revoked_at: null,
      user: activeUser,
    });
    await expect(owner.resolve('expired')).rejects.toMatchObject({
      statusCode: 401,
    });
    findByTokenHash.mockResolvedValueOnce({
      expires_at: new Date('2026-08-01T00:00:00.000Z'),
      revoked_at: new Date(),
      user: activeUser,
    });
    await expect(owner.resolve('revoked')).rejects.toMatchObject({
      statusCode: 401,
    });
    findByTokenHash.mockResolvedValueOnce({
      expires_at: new Date('2026-08-01T00:00:00.000Z'),
      revoked_at: null,
      user: { ...activeUser, status: 'inactive' },
    });
    await expect(owner.resolve('inactive')).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('revokes by digest without storing or returning the token', async () => {
    const revokeByTokenHash = vi.fn(async () => true);
    const owner = createUserSessionOwner({
      secret: 'session-secret-that-is-long-enough',
      store: {
        create: vi.fn(),
        findByTokenHash: vi.fn(),
        revokeByTokenHash,
        touchLastSeen: vi.fn(),
      },
    });
    await expect(owner.revoke('plain-token')).resolves.toBe(true);
    expect(revokeByTokenHash).toHaveBeenCalledWith(
      expect.stringMatching(/^[a-f0-9]{64}$/),
      expect.any(Date),
    );
  });
});
