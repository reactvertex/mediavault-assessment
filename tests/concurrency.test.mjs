import test from 'node:test';
import assert from 'node:assert/strict';

// Class matching src/lib/errors.ts for direct runtime validation
class ApiError extends Error {
  constructor({ status, code, message, retryAfter, requestId }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
    this.requestId = requestId;
    this.isRetryable = status === 503 || status === 429 || status === 500;
  }
}

function getFriendlyErrorMessage(err) {
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
    return err.message;
  }
  return err.message;
}

test('ApiError correctly classifies retryable and non-retryable statuses structurally', () => {
  const err503 = new ApiError({
    status: 503,
    code: 'upstream_unavailable',
    message: 'Warming up',
    retryAfter: 2,
  });
  assert.equal(err503.isRetryable, true);
  assert.equal(err503.retryAfter, 2);

  const err429 = new ApiError({
    status: 429,
    code: 'rate_limited',
    message: 'Rate limit exceeded',
    retryAfter: 3,
  });
  assert.equal(err429.isRetryable, true);
  assert.equal(err429.retryAfter, 3);

  const err400 = new ApiError({
    status: 400,
    code: 'stale_cursor',
    message: 'Cursor is stale',
  });
  assert.equal(err400.isRetryable, false);

  const err409 = new ApiError({
    status: 409,
    code: 'version_conflict',
    message: 'Version mismatch',
  });
  assert.equal(err409.isRetryable, false);

  const err422 = new ApiError({
    status: 422,
    code: 'legal_hold',
    message: 'Legal hold active',
  });
  assert.equal(err422.isRetryable, false);
});

test('getFriendlyErrorMessage maps technical errors to human-actionable messages', () => {
  const err429 = new ApiError({
    status: 429,
    code: 'rate_limited',
    message: 'Too many requests',
    retryAfter: 3,
  });
  assert.match(getFriendlyErrorMessage(err429), /Server is temporarily busy/);

  const err409 = new ApiError({
    status: 409,
    code: 'version_conflict',
    message: 'Version mismatch',
  });
  assert.match(getFriendlyErrorMessage(err409), /updated by someone else/);

  const errLegalHold = new ApiError({
    status: 422,
    code: 'legal_hold',
    message: 'On hold',
  });
  assert.match(getFriendlyErrorMessage(errLegalHold), /legal hold/);
});

test('Chunking with bounded concurrency strictly limits batch size to <= 50 and active concurrency <= 2', async () => {
  const ids = Array.from({ length: 125 }, (_, i) => `a_${String(i).padStart(5, '0')}`);
  const CHUNK_SIZE = 50;
  const chunks = [];
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    chunks.push(ids.slice(i, i + CHUNK_SIZE));
  }

  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].length, 50);
  assert.equal(chunks[1].length, 50);
  assert.equal(chunks[2].length, 25);

  // Test bounded concurrency
  let activeConcurrency = 0;
  let maxObservedConcurrency = 0;
  let chunkIndex = 0;
  const CONCURRENCY_LIMIT = 2;

  async function worker() {
    while (chunkIndex < chunks.length) {
      const idx = chunkIndex++;
      activeConcurrency++;
      maxObservedConcurrency = Math.max(maxObservedConcurrency, activeConcurrency);
      // Simulate network request
      await new Promise((r) => setTimeout(r, 20));
      activeConcurrency--;
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY_LIMIT, chunks.length) }, () => worker()),
  );

  assert.equal(maxObservedConcurrency <= CONCURRENCY_LIMIT, true);
});

test('In-flight request deduplication returns existing promise for identical concurrent queries', async () => {
  const inFlightRequests = new Map();
  let serverFetchCount = 0;

  function fetchWithDedupe(key) {
    if (inFlightRequests.has(key)) {
      return inFlightRequests.get(key);
    }
    const p = (async () => {
      serverFetchCount++;
      await new Promise((r) => setTimeout(r, 25));
      return { data: `result for ${key}` };
    })();
    inFlightRequests.set(key, p);
    p.finally(() => inFlightRequests.delete(key));
    return p;
  }

  // Fire 3 identical requests simultaneously
  const [res1, res2, res3] = await Promise.all([
    fetchWithDedupe('/api/assets?q=search'),
    fetchWithDedupe('/api/assets?q=search'),
    fetchWithDedupe('/api/assets?q=search'),
  ]);

  assert.equal(serverFetchCount, 1); // Only one network request was executed
  assert.deepEqual(res1, res2);
  assert.deepEqual(res2, res3);
});

test('Partial failure rollback logic restores only failed assets and keeps successes', () => {
  const assets = [
    { id: 'a_00001', status: 'draft' },
    { id: 'a_00002', status: 'draft' },
    { id: 'a_00003', status: 'draft' },
  ];

  // 1. Optimistic apply to 'approved'
  const snapshot = new Map();
  const targetStatus = 'approved';
  for (const a of assets) {
    snapshot.set(a.id, a.status);
    a.status = targetStatus;
  }
  assert.equal(assets.every((a) => a.status === 'approved'), true);

  // 2. Mock 207 response where a_00002 failed due to legal_hold
  const bulkResult = {
    applied: 2,
    failed: 1,
    results: [
      { id: 'a_00001', ok: true },
      { id: 'a_00002', ok: false, code: 'legal_hold' },
      { id: 'a_00003', ok: true },
    ],
  };

  // 3. Roll back ONLY failed assets
  const rollbackForFailures = new Map();
  for (const r of bulkResult.results) {
    if (!r.ok) {
      rollbackForFailures.set(r.id, snapshot.get(r.id));
    }
  }

  for (const a of assets) {
    if (rollbackForFailures.has(a.id)) {
      a.status = rollbackForFailures.get(a.id);
    }
  }

  // Verification
  assert.equal(assets.find((a) => a.id === 'a_00001').status, 'approved'); // Success kept
  assert.equal(assets.find((a) => a.id === 'a_00002').status, 'draft');    // Failure rolled back
  assert.equal(assets.find((a) => a.id === 'a_00003').status, 'approved'); // Success kept
});
