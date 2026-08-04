const RETRYABLE_PROVIDER_STATUSES = new Set([408, 425, 429]);

export function isRetryableProviderStatus(status: number): boolean {
  return (
    RETRYABLE_PROVIDER_STATUSES.has(status) || (status >= 500 && status <= 599)
  );
}

export class ProviderHttpError extends Error {
  readonly status: number;
  readonly retryable: boolean;

  constructor(status: number) {
    super(`Provider returned HTTP ${status}`);
    this.name = 'ProviderHttpError';
    this.status = status;
    this.retryable = isRetryableProviderStatus(status);
  }
}
