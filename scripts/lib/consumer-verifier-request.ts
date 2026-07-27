type ConsumerPayload = Record<string, unknown>;

export type ConsumerInjectOptions = {
  method: string;
  url: string;
  headers?: Record<string, string>;
  payload?: unknown;
  [key: string]: unknown;
};

export function enableConsumerVerifierMockIdentity(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (env.NODE_ENV === 'production') {
    throw new Error('Consumer verifier mock identity is forbidden in production');
  }
  env.CURRENT_USER_MOCK_HEADERS_ENABLED = 'true';
}

export function consumerVerifierHeaders(
  userId: string,
  headers: Record<string, string> = {},
): Record<string, string> {
  const trustedUserId = userId.trim();
  if (!trustedUserId) {
    throw new Error('Consumer verifier requires a non-empty test user id');
  }
  const {
    'x-user-id': _userId,
    'x-openid': _openid,
    ...businessHeaders
  } = headers;
  return {
    ...businessHeaders,
    'x-user-id': trustedUserId,
  };
}

function withoutBodyIdentity(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }
  const {
    user_id: _userId,
    user_openid: _userOpenid,
    ...businessPayload
  } = payload as ConsumerPayload;
  return businessPayload;
}

export async function injectAsConsumer<TResponse>(
  app: { inject(options: ConsumerInjectOptions): Promise<TResponse> },
  userId: string,
  request: ConsumerInjectOptions,
): Promise<TResponse> {
  return app.inject({
    ...request,
    headers: consumerVerifierHeaders(userId, request.headers),
    payload: withoutBodyIdentity(request.payload),
  });
}

