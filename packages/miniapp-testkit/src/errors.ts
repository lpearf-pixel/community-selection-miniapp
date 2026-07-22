export interface InfrastructureErrorOptions {
  cause?: unknown;
  code?: string;
  retryable?: boolean;
}

export class InfrastructureError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(message: string, options: InfrastructureErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'InfrastructureError';
    this.code = options.code ?? 'INFRASTRUCTURE_ERROR';
    this.retryable = options.retryable ?? false;
  }
}

export class BusinessAssertionError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'BusinessAssertionError';
  }
}
