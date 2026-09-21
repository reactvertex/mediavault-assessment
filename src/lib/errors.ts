/**
 * Structured API Error handling.
 * Categorizes errors structurally (status code, error code) rather than
 * via fragile string matching, honoring Retry-After and differentiating
 * retryable from non-retryable operations.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfter?: number; // in seconds
  readonly isRetryable: boolean;
  readonly requestId?: string;

  constructor(options: {
    status: number;
    code: string;
    message: string;
    retryAfter?: number;
    requestId?: string;
  }) {
    super(options.message);
    this.name = 'ApiError';
    this.status = options.status;
    this.code = options.code;
    this.retryAfter = options.retryAfter;
    this.requestId = options.requestId;

    // Structural retry determination
    // 503 (upstream unavailable), 429 (rate limited), 500 (write_failed) are transient and retryable.
    // 400 (bad_request, stale_cursor), 404 (not_found), 409 (version_conflict), 422 (validation) are NOT retryable.
    this.isRetryable =
      options.status === 503 ||
      options.status === 429 ||
      options.status === 500;
  }
}

/**
 * Maps technical or HTTP error details into human-friendly, actionable messages.
 */
export function getFriendlyErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 429) {
      const wait = err.retryAfter ? ` for ${err.retryAfter}s` : '';
      return `Server is temporarily busy. Pausing${wait} and retrying automatically…`;
    }
    if (err.status === 503) {
      return 'The search service is warming up. Retrying in a moment…';
    }
    if (err.status === 409 || err.code === 'version_conflict') {
      return 'This asset was updated by someone else while you were viewing it.';
    }
    if (err.code === 'legal_hold') {
      return 'This asset is on legal hold and cannot be modified or archived.';
    }
    if (err.code === 'stale_cursor') {
      return 'The asset list has updated. Resetting to the start of the results.';
    }
    if (err.code === 'too_many_ids') {
      return 'Too many items selected in one operation. Batching has been adjusted.';
    }
    if (err.code === 'invalid_name') {
      return 'Asset name must be at least 3 characters long.';
    }
    if (err.status === 404) {
      return 'The requested asset could not be found.';
    }
    return err.message;
  }

  if (err instanceof TypeError && err.message.toLowerCase().includes('fetch')) {
    return 'Unable to reach the server. Please check your internet connection.';
  }

  if (err instanceof DOMException && err.name === 'AbortError') {
    return 'Request was cancelled.';
  }

  if (err instanceof Error) {
    return err.message;
  }

  return 'An unexpected error occurred. Please try again.';
}
