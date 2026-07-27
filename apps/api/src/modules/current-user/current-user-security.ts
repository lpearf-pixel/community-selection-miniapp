import type { Prisma } from '@prisma/client';
import { prisma } from '../../db.js';
import {
  createPrismaUserSessionStore,
  createUserSessionOwner,
  UserSessionError,
  type SessionUser,
} from './user-session-owner.js';

export const CURRENT_USER_SELECT = {
  id: true,
  openid: true,
  role: true,
  status: true,
  nickname: true,
  avatar_url: true,
} as const satisfies Prisma.UserSelect;

export type CurrentUserIdentity = Prisma.UserGetPayload<{
  select: typeof CURRENT_USER_SELECT;
}>;

export type CurrentLeaderIdentity = CurrentUserIdentity & {
  role: 'leader';
};

export type CurrentUserRouteError = {
  statusCode: number;
  message: string;
};

export type SafeErrorLogMetadata = {
  operation: string;
  error_name: string;
  error_code: string;
};

export type ResolveCurrentUserOptions = {
  nodeEnv?: string;
  mockHeadersEnabled?: boolean;
  sessionOwner?: {
    resolve(token: string): Promise<SessionUser>;
  };
};

export class PublicCurrentUserError extends Error {
  readonly exposeToClient = true;

  constructor(message: string, readonly statusCode: number) {
    super(message);
    this.name = 'PublicCurrentUserError';
  }
}

export function publicCurrentUserError(
  message: string,
  statusCode: number,
): PublicCurrentUserError {
  return new PublicCurrentUserError(message, statusCode);
}

function headerValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item !== 'string') continue;
      const trimmed = item.trim();
      if (trimmed) return trimmed;
    }
  }

  return undefined;
}

function bearerToken(value: unknown): string | undefined {
  const header = headerValue(value);
  if (!header) return undefined;
  const match = /^Bearer\s+([A-Za-z0-9_-]{16,512})$/i.exec(header);
  return match?.[1];
}

function defaultSessionOwner() {
  const secret = process.env.USER_SESSION_TOKEN_SECRET?.trim() ?? '';
  if (secret.length < 32) {
    throw publicCurrentUserError('用户登录已失效', 401);
  }
  return createUserSessionOwner({
    secret,
    store: createPrismaUserSessionStore(),
  });
}

export async function resolveCurrentUser(
  headers: Record<string, unknown>,
  client: Pick<typeof prisma, 'user'> = prisma,
  options: ResolveCurrentUserOptions = {},
): Promise<CurrentUserIdentity> {
  const token = bearerToken(headers.authorization);
  if (token) {
    const owner = options.sessionOwner ?? defaultSessionOwner();
    return owner.resolve(token);
  }

  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? 'development';
  const mockHeadersEnabled =
    nodeEnv !== 'production' &&
    (options.mockHeadersEnabled ??
      process.env.CURRENT_USER_MOCK_HEADERS_ENABLED === 'true');
  if (!mockHeadersEnabled) {
    throw publicCurrentUserError('缺少用户身份', 401);
  }

  const userId = headerValue(headers['x-user-id']);
  const openid = headerValue(headers['x-openid']);

  if (!userId && !openid) {
    throw publicCurrentUserError('缺少用户身份', 401);
  }

  const user = userId
    ? await client.user.findUnique({
        where: { id: userId },
        select: CURRENT_USER_SELECT,
      })
    : await client.user.findUnique({
        where: { openid: openid! },
        select: CURRENT_USER_SELECT,
      });

  if (!user) {
    throw publicCurrentUserError('用户不存在', 404);
  }

  if (user.status !== 'active') {
    throw publicCurrentUserError('用户状态不可用', 403);
  }

  return user;
}

export function requireCurrentLeader(
  user: CurrentUserIdentity,
): asserts user is CurrentLeaderIdentity {
  if (user.role !== 'leader') {
    throw publicCurrentUserError('仅开团人可访问', 403);
  }
}

export function mapCurrentUserRouteError(
  error: unknown,
  fallbackMessage: string,
): CurrentUserRouteError {
  if (
    (error instanceof PublicCurrentUserError ||
      error instanceof UserSessionError) &&
    Number.isInteger(error.statusCode) &&
    error.statusCode >= 400 &&
    error.statusCode < 500
  ) {
    return {
      statusCode: error.statusCode,
      message: error.message,
    };
  }

  return {
    statusCode: 500,
    message: fallbackMessage,
  };
}

const STABLE_ERROR_CODE_PATTERN = /^(?:[A-Z][A-Z0-9_]{0,63}|[0-9]{1,10})$/;
const SAFE_ERROR_NAMES = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'URIError',
  'EvalError',
  'PrismaClientKnownRequestError',
  'PrismaClientUnknownRequestError',
  'PrismaClientRustPanicError',
  'PrismaClientInitializationError',
  'PrismaClientValidationError',
]);

function stableErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return 'UNKNOWN';
  }

  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string') {
    const trimmed = code.trim();
    return STABLE_ERROR_CODE_PATTERN.test(trimmed) ? trimmed : 'UNKNOWN';
  }
  if (typeof code === 'number' && Number.isSafeInteger(code) && code >= 0) {
    return String(code);
  }

  return 'UNKNOWN';
}

function safeErrorName(error: unknown): string {
  if (!(error instanceof Error)) return 'UnknownError';
  return SAFE_ERROR_NAMES.has(error.name) ? error.name : 'UnknownError';
}

export function safeErrorLogMetadata(
  operation: string,
  error: unknown,
): SafeErrorLogMetadata {
  return {
    operation,
    error_name: safeErrorName(error),
    error_code: stableErrorCode(error),
  };
}
