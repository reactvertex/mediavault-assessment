import { useCallback, useEffect, useRef, useState } from 'react';
import { listAssets } from '@/api/client';
import { assetEvents } from '@/api/events';
import { getFriendlyErrorMessage } from '@/lib/errors';
import type { Asset, AssetQuery, AssetStatus } from '@/lib/types';

interface UseAssetsReturn {
  items: Asset[];
  total: number;
  isLoadingInitial: boolean;
  isLoadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  refresh: () => void;
  updateLocalAsset: (updated: Asset) => void;
  applyOptimisticStatus: (ids: string[], nextStatus: AssetStatus) => Map<string, AssetStatus>;
  rollbackStatus: (previousStates: Map<string, AssetStatus>) => void;
}

export function useAssets(query: AssetQuery): UseAssetsReturn {
  const [items, setItems] = useState<Asset[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingInitial, setIsLoadingInitial] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const loadMoreAbortRef = useRef<AbortController | null>(null);
  const queryRef = useRef(query);
  queryRef.current = query;

  // Track query fingerprint to detect changes
  const queryFingerprint = JSON.stringify({
    q: query.q?.trim() || '',
    status: (query.status || []).slice().sort(),
    kind: (query.kind || []).slice().sort(),
    tag: (query.tag || []).slice().sort(),
    sort: query.sort || 'updatedAt:desc',
    collectionId: query.collectionId || '',
    owner: query.owner || '',
  });

  const fetchInitial = useCallback(() => {
    // Abort previous in-flight initial search/filter requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const ac = new AbortController();
    abortControllerRef.current = ac;

    setIsLoadingInitial(true);
    setError(null);
    setNextCursor(null); // Crucial: clear cursor immediately to prevent 400 stale_cursor

    const currentQ = queryRef.current;

    listAssets(
      {
        q: currentQ.q,
        status: currentQ.status,
        kind: currentQ.kind,
        tag: currentQ.tag,
        collectionId: currentQ.collectionId,
        owner: currentQ.owner,
        sort: currentQ.sort,
        limit: 24,
      },
      ac.signal,
    )
      .then((page) => {
        if (ac.signal.aborted) return;
        setItems(page.items);
        setTotal(page.total);
        setNextCursor(page.nextCursor);
        setIsLoadingInitial(false);
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        setIsLoadingInitial(false);
        setError(getFriendlyErrorMessage(err));
      });
  }, []);

  // Fetch when query criteria change
  useEffect(() => {
    fetchInitial();

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [queryFingerprint, fetchInitial]);

  // Load next page using cursor pagination
  const loadMore = useCallback(() => {
    if (!nextCursor || isLoadingMore || isLoadingInitial) return;

    if (loadMoreAbortRef.current) {
      loadMoreAbortRef.current.abort();
    }
    const ac = new AbortController();
    loadMoreAbortRef.current = ac;

    setIsLoadingMore(true);

    const currentQ = queryRef.current;

    listAssets(
      {
        q: currentQ.q,
        status: currentQ.status,
        kind: currentQ.kind,
        tag: currentQ.tag,
        collectionId: currentQ.collectionId,
        owner: currentQ.owner,
        sort: currentQ.sort,
        cursor: nextCursor,
        limit: 24,
      },
      ac.signal,
    )
      .then((page) => {
        if (ac.signal.aborted) return;
        // Append new unique assets
        setItems((prev) => {
          const existingIds = new Set(prev.map((a) => a.id));
          const newItems = page.items.filter((a) => !existingIds.has(a.id));
          return [...prev, ...newItems];
        });
        setTotal(page.total);
        setNextCursor(page.nextCursor);
        setIsLoadingMore(false);
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        setIsLoadingMore(false);
        setError(getFriendlyErrorMessage(err));
      });
  }, [nextCursor, isLoadingMore, isLoadingInitial]);

  // Update a single asset in local state
  const updateLocalAsset = useCallback((updated: Asset) => {
    setItems((prev) =>
      prev.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)),
    );
  }, []);

  // Optimistic bulk status update
  const applyOptimisticStatus = useCallback(
    (ids: string[], nextStatus: AssetStatus): Map<string, AssetStatus> => {
      const idSet = new Set(ids);
      const snapshot = new Map<string, AssetStatus>();

      setItems((prev) =>
        prev.map((asset) => {
          if (idSet.has(asset.id)) {
            snapshot.set(asset.id, asset.status);
            return { ...asset, status: nextStatus, updatedAt: new Date().toISOString() };
          }
          return asset;
        }),
      );

      return snapshot;
    },
    [],
  );

  // Roll back specific assets if an operation failed
  const rollbackStatus = useCallback((previousStates: Map<string, AssetStatus>) => {
    setItems((prev) =>
      prev.map((asset) => {
        if (previousStates.has(asset.id)) {
          return {
            ...asset,
            status: previousStates.get(asset.id)!,
            updatedAt: new Date().toISOString(),
          };
        }
        return asset;
      }),
    );
  }, []);

  // Subscribe to real-time Server-Sent Events to keep view current
  useEffect(() => {
    const unsubscribe = assetEvents.subscribe((updatedAsset) => {
      setItems((prev) => {
        const index = prev.findIndex((a) => a.id === updatedAsset.id);
        if (index === -1) return prev;
        // Update in-place without disturbing order or scroll
        const next = [...prev];
        next[index] = { ...next[index], ...updatedAsset };
        return next;
      });
    });

    return () => unsubscribe();
  }, []);

  return {
    items,
    total,
    isLoadingInitial,
    isLoadingMore,
    error,
    hasMore: Boolean(nextCursor),
    loadMore,
    refresh: fetchInitial,
    updateLocalAsset,
    applyOptimisticStatus,
    rollbackStatus,
  };
}
