import { createHmac, randomBytes as nodeRandomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../db.js';

export const USER_SESSION_USER_SELECT = {
  id: true,
  openid: true,
  role: true,
  status: true,
  nickname: true,
  avatar_url: true,
} as const satisfies Prisma.UserSelect;

export type SessionUser = Prisma.UserGetPayload<{
  select: typeof USER_SESSION_USER_SELECT;
}>;

type StoredSession = {
  expires_at: Date;
  revoked_at: Date | null;
  last_seen_at?: Date | null;
  user: SessionUser;
};

export type UserSessionStore = {
  create(input: {
    user_id: string;
    token_hash: string;
    expires_at: Date;
  }): Promise<StoredSession & { id: string }>;
  findByTokenHash(tokenHash: string): Promise<StoredSession | null>;
  revokeByTokenHash(tokenHash: string, revokedAt: Date): Promise<boolean>;
  touchLastSeen(tokenHash: string, seenAt: Date): Promise<void>;
};

export class UserSessionError extends Error {
  constructor(
    message: string,
    readonly statusCode: 401 | 403,
  ) {
    super(message);
    this.name = 'UserSessionError';
  }
}

function digest(secret: string, token: string): string {
  return createHmac('sha256', secret).update(token).digest('hex');
}

export function createUserSessionOwner(options: {
  secret: string;
  store: UserSessionStore;
  now?: () => Date;
  randomBytes?: () => Buffer;
  ttlMs?: number;
}) {
  if (options.secret.length < 32) {
    throw new Error('USER_SESSION_TOKEN_SECRET must be at least 32 characters');
  }
  const now = options.now ?? (() => new Date());
  const randomBytes = options.randomBytes ?? (() => nodeRandomBytes(32));
  const ttlMs = options.ttlMs ?? 30 * 24 * 60 * 60 * 1_000;

  return {
    async issue(userId: string) {
      const token = randomBytes().toString('base64url');
      const issuedAt = now();
      const expiresAt = new Date(issuedAt.getTime() + ttlMs);
      await options.store.create({
        user_id: userId,
        token_hash: digest(options.secret, token),
        expires_at: expiresAt,
      });
      return { token, expires_at: expiresAt };
    },

    async resolve(token: string): Promise<SessionUser> {
      if (!token) throw new UserSessionError('用户登录已失效', 401);
      const tokenHash = digest(options.secret, token);
      const session = await options.store.findByTokenHash(tokenHash);
      const current = now();
      if (
        !session ||
        session.revoked_at ||
        session.expires_at.getTime() <= current.getTime()
      ) {
        throw new UserSessionError('用户登录已失效', 401);
      }
      if (session.user.status !== 'active') {
        throw new UserSessionError('用户状态不可用', 403);
      }
      if (
        !session.last_seen_at ||
        current.getTime() - session.last_seen_at.getTime() >= 5 * 60 * 1_000
      ) {
        await options.store.touchLastSeen(tokenHash, current);
      }
      return session.user;
    },

    revoke(token: string): Promise<boolean> {
      return options.store.revokeByTokenHash(digest(options.secret, token), now());
    },
  };
}

export function createPrismaUserSessionStore(
  client: Pick<typeof prisma, 'userSession'> = prisma,
): UserSessionStore {
  return {
    create(input) {
      return client.userSession.create({
        data: input,
        include: { user: { select: USER_SESSION_USER_SELECT } },
      });
    },
    findByTokenHash(tokenHash) {
      return client.userSession.findUnique({
        where: { token_hash: tokenHash },
        include: { user: { select: USER_SESSION_USER_SELECT } },
      });
    },
    async revokeByTokenHash(tokenHash, revokedAt) {
      const result = await client.userSession.updateMany({
        where: { token_hash: tokenHash, revoked_at: null },
        data: { revoked_at: revokedAt },
      });
      return result.count === 1;
    },
    async touchLastSeen(tokenHash, seenAt) {
      await client.userSession.updateMany({
        where: { token_hash: tokenHash, revoked_at: null },
        data: { last_seen_at: seenAt },
      });
    },
  };
}
