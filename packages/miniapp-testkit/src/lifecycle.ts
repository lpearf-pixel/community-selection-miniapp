export type Cleanup = () => Promise<unknown>;

export interface ScenarioLifecycleOptions<T> {
  run: () => Promise<T>;
  cleanups?: Cleanup[];
  onCleanupError?: (error: Error) => void;
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export async function runScenarioLifecycle<T>(
  options: ScenarioLifecycleOptions<T>,
): Promise<T> {
  let result: T | undefined;
  let primary: Error | undefined;
  const cleanupErrors: Error[] = [];

  try {
    result = await options.run();
  } catch (error) {
    primary = asError(error);
  }

  for (const cleanup of [...(options.cleanups ?? [])].reverse()) {
    try {
      await cleanup();
    } catch (error) {
      const normalized = asError(error);
      cleanupErrors.push(normalized);
      options.onCleanupError?.(normalized);
    }
  }

  if (primary) {
    Object.defineProperty(primary, 'cleanupErrors', {
      configurable: true,
      enumerable: true,
      value: cleanupErrors,
    });
    throw primary;
  }
  if (cleanupErrors.length) {
    throw new AggregateError(
      cleanupErrors,
      `Scenario cleanup failed: ${cleanupErrors.map((error) => error.message).join('; ')}`,
    );
  }
  return result as T;
}
