import { ApiError } from '@/lib/errors';
import type { Asset, AssetPage, AssetQuery, BulkResult } from '@/lib/types';

interface RequestOptions extends RequestInit {
  retry?: boolean;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

// In-flight deduplication cache for GET requests
const inFlightRequests = new Map<string, Promise<unknown>>();

function toSearchParams(query: AssetQuery): string {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.status?.length) params.set('status', query.status.join(','));
  if (query.kind?.length) params.set('kind', query.kind.join(','));
  if (query.tag?.length) params.set('tag', query.tag.join(','));
  if (query.collectionId) params.set('collectionId', query.collectionId);
  if (query.owner) params.set('owner', query.owner);
  if (query.sort) params.set('sort', query.sort);
  if (query.limit) params.set('limit', String(query.limit));
  if (query.cursor) params.set('cursor', query.cursor);
  return params.toString();
}

const sleep = (ms: number, signal?: AbortSignal | null) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new DOMException('Aborted', 'AbortError'));
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }
    signal?.addEventListener('abort', onAbort);
  });

/**
 * Executes an HTTP request with:
 * - Structured error handling via ApiError
 * - Automatic exponential backoff + jitter for retryable transient errors (503, 429, 500, network)
 * - Honoring Retry-After headers from rate limits or warm-up
 * - Deduplication of concurrent identical GET requests
 * - Full AbortSignal cancellation support
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const {
    retry = true,
    maxRetries = 3,
    baseDelayMs = 250,
    maxDelayMs = 4000,
    signal,
    headers,
    ...init
  } = options;

  const method = (init.method ?? 'GET').toUpperCase();
  const isGet = method === 'GET';

  // In-flight deduplication for identical concurrent GET requests
  const dedupeKey = isGet ? `${path}` : null;
  if (dedupeKey && inFlightRequests.has(dedupeKey)) {
    return inFlightRequests.get(dedupeKey) as Promise<T>;
  }

  const executionPromise = (async () => {
    let attempt = 0;

    while (true) {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      let res: Response | null = null;
      let networkError: unknown = null;

      try {
        res = await fetch(path, {
          ...init,
          method,
          signal,
          headers: {
            'content-type': 'application/json',
            ...(headers ?? {}),
          },
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          throw err;
        }
        networkError = err;
      }

      if (res && res.ok) {
        if (res.status === 204) return null as unknown as T;
        return (await res.json()) as T;
      }

      // Handle 207 Multi-Status for bulk operations
      if (res && res.status === 207) {
        return (await res.json()) as T;
      }

      // Parse error response
      let errorBody: { error?: { code?: string; message?: string } } | null = null;
      let message = res?.statusText || 'Network request failed';
      let code = 'unknown_error';
      const requestId = res?.headers.get('x-request-id') ?? undefined;
      const retryAfterHeader = res?.headers.get('retry-after');
      const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : undefined;

      if (res) {
        try {
          errorBody = await res.json();
          if (errorBody?.error) {
            code = errorBody.error.code ?? code;
            message = errorBody.error.message ?? message;
          }
        } catch {
          // Response body was not JSON
        }
      } else if (networkError instanceof Error) {
        message = networkError.message;
        code = 'network_error';
      }

      const status = res ? res.status : 0;
      const apiError = new ApiError({
        status,
        code,
        message,
        retryAfter: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : undefined,
        requestId,
      });

      // Check if retry should be attempted
      const shouldRetry = retry && attempt < maxRetries && (apiError.isRetryable || status === 0);

      if (!shouldRetry) {
        throw apiError;
      }

      attempt++;

      // Compute backoff delay with full jitter
      let backoffMs = baseDelayMs * Math.pow(2, attempt) + Math.random() * 200;
      if (apiError.retryAfter) {
        backoffMs = Math.max(backoffMs, apiError.retryAfter * 1000);
      }
      backoffMs = Math.min(backoffMs, maxDelayMs);

      try {
        await sleep(backoffMs, signal);
      } catch (err) {
        throw err;
      }
    }
  })();

  if (dedupeKey) {
    inFlightRequests.set(dedupeKey, executionPromise);
    executionPromise.finally(() => {
      inFlightRequests.delete(dedupeKey);
    });
  }

  return executionPromise;
}

export function listAssets(query: AssetQuery, signal?: AbortSignal): Promise<AssetPage> {
  return request<AssetPage>(`/api/assets?${toSearchParams(query)}`, { signal });
}

export function getAsset(id: string, signal?: AbortSignal): Promise<Asset> {
  return request<Asset>(`/api/assets/${id}`, { signal });
}

export async function getAssetsByIds(
  ids: string[],
  signal?: AbortSignal,
): Promise<{ items: Asset[]; missing: string[] }> {
  if (ids.length === 0) return { items: [], missing: [] };

  // Backend hard cap: 25 ids per request
  const CHUNK_SIZE = 25;
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    chunks.push(ids.slice(i, i + CHUNK_SIZE));
  }

  const allItems: Asset[] = [];
  const allMissing: string[] = [];

  for (const chunk of chunks) {
    const res = await request<{ items: Asset[]; missing: string[] }>(
      `/api/assets/batch?ids=${chunk.join(',')}`,
      { signal },
    );
    allItems.push(...res.items);
    allMissing.push(...res.missing);
  }

  return { items: allItems, missing: allMissing };
}

export function updateAsset(
  id: string,
  version: number,
  patch: Partial<Pick<Asset, 'name' | 'status' | 'tags'>>,
  signal?: AbortSignal,
): Promise<Asset> {
  return request<Asset>(`/api/assets/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ version, patch }),
    signal,
    retry: true,
  });
}

/**
 * Bulk updates asset statuses respecting the server's 50-item cap and
 * bounded concurrency to prevent tripping rate limits (80 requests per 10s).
 */
export async function bulkSetStatus(
  ids: string[],
  status: Asset['status'],
  signal?: AbortSignal,
): Promise<BulkResult> {
  if (ids.length === 0) {
    return { results: [], applied: 0, failed: 0 };
  }

  const CHUNK_SIZE = 50; // Server hard limit is 50
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    chunks.push(ids.slice(i, i + CHUNK_SIZE));
  }

  // Execute chunks with bounded concurrency pool (max 2 parallel requests)
  const CONCURRENCY_LIMIT = 2;
  const chunkResults: BulkResult[] = [];
  let index = 0;

  async function worker(): Promise<void> {
    while (index < chunks.length) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const currentIndex = index++;
      const chunk = chunks[currentIndex];
      const res = await request<BulkResult>('/api/assets/bulk-status', {
        method: 'POST',
        body: JSON.stringify({ ids: chunk, status }),
        signal,
        retry: true,
      });
      chunkResults.push(res);
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY_LIMIT, chunks.length) }, () =>
    worker(),
  );
  await Promise.all(workers);

  // Aggregate chunk results
  const aggregated: BulkResult = {
    results: [],
    applied: 0,
    failed: 0,
  };

  for (const cr of chunkResults) {
    aggregated.results.push(...cr.results);
    aggregated.applied += cr.applied;
    aggregated.failed += cr.failed;
  }

  return aggregated;
}

export function getStats(signal?: AbortSignal): Promise<{
  total: number;
  byStatus: Record<string, number>;
  byKind: Record<string, number>;
  totalBytes: number;
}> {
  return request('/api/stats', { signal, retry: true });
}

export function getFacets(signal?: AbortSignal): Promise<{
  tags: string[];
  owners: Array<{ id: string; name: string }>;
  statuses: string[];
  kinds: string[];
}> {
  return request('/api/facets', { signal, retry: true });
}

export function getCollections(signal?: AbortSignal): Promise<{
  items: Array<{ id: string; name: string }>;
}> {
  return request('/api/collections', { signal, retry: true });
}

export const thumbnailUrl = (id: string) => `/api/thumb/${id}.svg`;
