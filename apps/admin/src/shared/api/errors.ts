export type AdminApiErrorCode =
  | 'REQUEST_ABORTED'
  | 'REQUEST_TIMEOUT'
  | 'NETWORK_ERROR'
  | 'INVALID_RESPONSE'
  | string;

export class AdminApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: AdminApiErrorCode,
    readonly traceId?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AdminApiError';
  }
}
