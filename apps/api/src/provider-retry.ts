import { ProviderHttpError } from '@iptvmaster/core';

const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'ETIMEDOUT',
]);

export interface ProviderRetryOptions {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  sleep: (delayMs: number) => Promise<void>;
}

export const DEFAULT_PROVIDER_RETRY_OPTIONS: ProviderRetryOptions = {
  maxAttempts: 3,
  initialDelayMs: 2_000,
  maxDelayMs: 30_000,
  sleep: (delayMs) =>
    new Promise((resolve) => {
      setTimeout(resolve, delayMs);
    }),
};

export function isRetryableProviderError(error: unknown): boolean {
  if (error instanceof ProviderHttpError) return error.retryable;
  if (error instanceof TypeError) return true;
  if (!(error instanceof Error)) return false;
  if (error.name === 'AbortError' || error.name === 'TimeoutError') return true;
  const code = (error as Error & { code?: unknown }).code;
  return typeof code === 'string' && RETRYABLE_NETWORK_CODES.has(code);
}

export async function withProviderRetry<T>(
  operation: () => Promise<T>,
  overrides: Partial<ProviderRetryOptions> = {},
): Promise<T> {
  const options = { ...DEFAULT_PROVIDER_RETRY_OPTIONS, ...overrides };
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts));
  const initialDelayMs = Math.max(0, options.initialDelayMs);
  const maxDelayMs = Math.max(0, options.maxDelayMs);

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryableProviderError(error)) {
        throw error;
      }
      const delayMs = Math.min(maxDelayMs, initialDelayMs * 2 ** (attempt - 1));
      await options.sleep(delayMs);
    }
  }
}
