import { InfrastructureError } from './errors.js';

export interface TimeoutOptions {
  label: string;
  timeoutMs: number;
}

export async function withTimeout<T>(
  operation: () => Promise<T>,
  options: TimeoutOptions,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new InfrastructureError(
      `Timed out after ${options.timeoutMs} ms during ${options.label}`,
      { code: 'OPERATION_TIMEOUT', retryable: true },
    )), options.timeoutMs);
  });

  try {
    return await Promise.race([Promise.resolve().then(operation), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface RetryOptions {
  attempts: number;
  delayMs: number;
  label: string;
  onRetry?: (error: InfrastructureError, attempt: number) => void;
  sleep?: (milliseconds: number) => Promise<void>;
}

export async function retryInfrastructure<T>(
  operation: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const attempts = Math.max(1, Math.trunc(options.attempts));
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>(
    (resolve) => setTimeout(resolve, milliseconds),
  ));

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const infrastructure = error instanceof InfrastructureError ? error : null;
      if (!infrastructure?.retryable || attempt === attempts) throw error;
      options.onRetry?.(infrastructure, attempt);
      if (options.delayMs > 0) await sleep(options.delayMs);
    }
  }

  throw new Error(`Unreachable retry state for ${options.label}`);
}
