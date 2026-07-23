export type RequestContext = {
  correlationId?: string;
  idempotencyKey?: string;
  timeoutMs?: number;
};

export function requestContextHeaders(
  context: RequestContext | undefined,
): Record<string, string> {
  return {
    ...(context?.correlationId
      ? { 'x-correlation-id': context.correlationId }
      : {}),
    ...(context?.idempotencyKey
      ? { 'idempotency-key': context.idempotencyKey }
      : {}),
  };
}
