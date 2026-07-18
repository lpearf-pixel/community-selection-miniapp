type CenterRouteError = {
  statusCode: number;
  message: string;
};

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

export function assertCenterIdentityHeader(headers: Record<string, unknown>): void {
  const userId = headerValue(headers['x-user-id']);
  const openid = headerValue(headers['x-openid']);
  if (!userId && !openid) {
    throw Object.assign(new Error('缺少用户身份'), { statusCode: 401 });
  }
}

export function mapCenterRouteError(error: unknown, fallbackMessage: string): CenterRouteError {
  const candidate = error as { statusCode?: unknown } | null;
  const statusCode =
    candidate &&
    typeof candidate.statusCode === 'number' &&
    Number.isInteger(candidate.statusCode) &&
    candidate.statusCode >= 400 &&
    candidate.statusCode < 500
      ? candidate.statusCode
      : undefined;

  if (statusCode !== undefined) {
    return {
      statusCode,
      message: error instanceof Error ? error.message : fallbackMessage,
    };
  }

  return {
    statusCode: 500,
    message: fallbackMessage,
  };
}
