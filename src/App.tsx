import { useCallback, useEffect, useRef, useState } from 'react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { LiveRegion } from '@/components/LiveRegion';
import { OfflineBanner } from '@/components/OfflineBanner';
import { AssetDetail } from '@/features/assets/AssetDetail';
import { AssetGrid } from '@/features/assets/AssetGrid';
import { BulkBar } from '@/features/assets/BulkBar';
import { FilterBar } from '@/features/assets/FilterBar';
import { StatsHeader } from '@/features/assets/StatsHeader';
import { useAssets } from '@/features/assets/useAssets';
import type { Asset, AssetKind, AssetQuery, AssetStatus } from '@/lib/types';

function parseUrlState(): {
  q: string;
  status: AssetStatus[];
  kind: AssetKind[];
  sort: NonNullable<AssetQuery['sort']>;
  activeId: string | null;
} {
  if (typeof window === 'undefined') {
    return { q: '', status: [], kind: [], sort: 'updatedAt:desc', activeId: null };
  }
  const params = new URLSearchParams(window.location.search);
  const q = params.get('q') || '';
  const statusRaw = params.get('status');
  const status = statusRaw
    ? (statusRaw.split(',').filter(Boolean) as AssetStatus[])
    : [];
  const kindRaw = params.get('kind');
  const kind = kindRaw
    ? (kindRaw.split(',').filter(Boolean) as AssetKind[])
    : [];
  const sort = (params.get('sort') as NonNullable<AssetQuery['sort']>) || 'updatedAt:desc';
  const activeId = params.get('active') || null;

  return { q, status, kind, sort, activeId };
}

function syncUrl(
  state: {
    q: string;
    status: AssetStatus[];
    kind: AssetKind[];
    sort: string;
    activeId: string | null;
  },
  replace = false,
) {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.status.length) params.set('status', state.status.join(','));
  if (state.kind.length) params.set('kind', state.kind.join(','));
  if (state.sort && state.sort !== 'updatedAt:desc') params.set('sort', state.sort);
  if (state.activeId) params.set('active', state.activeId);

  const queryString = params.toString();
  const nextUrl = queryString ? `${window.location.pathname}?${queryString}` : window.location.pathname;

  if (replace) {
    window.history.replaceState({}, '', nextUrl);
  } else {
    window.history.pushState({}, '', nextUrl);
  }
}

export function App() {
  const initial = parseUrlState();
  const [q, setQ] = useState(initial.q);
  const [status, setStatus] = useState<AssetStatus[]>(initial.status);
  const [kind, setKind] = useState<AssetKind[]>(initial.kind);
  const [sort, setSort] = useState<NonNullable<AssetQuery['sort']>>(initial.sort);
  const [activeId, setActiveId] = useState<string | null>(initial.activeId);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);

  const activeTriggerRef = useRef<HTMLElement | null>(null);

  // Data fetching hook with infinite scroll, deduplication, cancellation, rollback
  const {
    items,
    total,
    isLoadingInitial,
    isLoadingMore,
    error,
    hasMore,
    loadMore,
    refresh,
    updateLocalAsset,
    applyOptimisticStatus,
    rollbackStatus,
  } = useAssets({ q, status, kind, sort });

  // Popstate listener to support browser Back and Forward navigation
  useEffect(() => {
    function handlePopState() {
      const parsed = parseUrlState();
      setQ(parsed.q);
      setStatus(parsed.status);
      setKind(parsed.kind);
      setSort(parsed.sort);
      setActiveId(parsed.activeId);
    }

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Sync search keystrokes to URL via replaceState (does not clutter history)
  const handleSearchChange = useCallback(
    (newQ: string) => {
      setQ(newQ);
      syncUrl({ q: newQ, status, kind, sort, activeId }, true);
    },
    [status, kind, sort, activeId],
  );

  // Sync discrete filter changes via pushState
  const handleStatusChange = useCallback(
    (newStatus: AssetStatus[]) => {
      setStatus(newStatus);
      syncUrl({ q, status: newStatus, kind, sort, activeId }, false);
    },
    [q, kind, sort, activeId],
  );

  const handleKindChange = useCallback(
    (newKind: AssetKind[]) => {
      setKind(newKind);
      syncUrl({ q, status, kind: newKind, sort, activeId }, false);
    },
    [q, status, sort, activeId],
  );

  const handleSortChange = useCallback(
    (newSort: NonNullable<AssetQuery['sort']>) => {
      setSort(newSort);
      syncUrl({ q, status, kind, sort: newSort, activeId }, false);
    },
    [q, status, kind, activeId],
  );

  const handleOpenDetail = useCallback(
    (id: string) => {
      // Remember which card was clicked to return focus on close
      activeTriggerRef.current = document.activeElement as HTMLElement;
      setActiveId(id);
      syncUrl({ q, status, kind, sort, activeId: id }, false);
    },
    [q, status, kind, sort],
  );

  const handleCloseDetail = useCallback(() => {
    setActiveId(null);
    syncUrl({ q, status, kind, sort, activeId: null }, false);
  }, [q, status, kind, sort]);

  const handleResetFilters = useCallback(() => {
    setQ('');
    setStatus([]);
    setKind([]);
    setSort('updatedAt:desc');
    syncUrl({ q: '', status: [], kind: [], sort: 'updatedAt:desc', activeId }, false);
    setAnnouncement('All filters reset.');
  }, [activeId]);

  // Single card selection toggle
  const handleToggleSelect = useCallback((id: string) => {
    setLastSelectedId(id);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Range selection (Shift + click or Shift + Arrow)
  const handleRangeSelect = useCallback(
    (startIndex: number, endIndex: number) => {
      const rangeIds = items.slice(startIndex, endIndex + 1).map((a) => a.id);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of rangeIds) next.add(id);
        return next;
      });
      setAnnouncement(`Selected ${rangeIds.length} assets in range.`);
    },
    [items],
  );

  // Select all loaded assets
  const handleSelectAllLoaded = useCallback(() => {
    const allIds = new Set(items.map((a) => a.id));
    setSelectedIds(allIds);
    setAnnouncement(`Selected all ${allIds.size} loaded assets.`);
  }, [items]);

  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setAnnouncement('Selection cleared.');
  }, []);

  // Saved callback from detail panel
  const handleSaved = useCallback(
    (updatedAsset: Asset) => {
      updateLocalAsset(updatedAsset);
      setAnnouncement(`Saved changes to ${updatedAsset.name}.`);
    },
    [updateLocalAsset],
  );

  // Announce search result count changes to screen readers
  useEffect(() => {
    if (!isLoadingInitial && !error) {
      setAnnouncement(
        total === 0
          ? 'No assets match the current filters.'
          : `${total.toLocaleString()} assets found. Showing ${items.length}.`,
      );
    }
  }, [total, items.length, isLoadingInitial, error]);

  return (
    <div className="app">
      <OfflineBanner onStatusChange={(online) => online && refresh()} />

      <header className="topbar">
        <div className="topbar__brand">
          <div className="topbar__logo" aria-hidden="true">
            MV
          </div>
          <div>
            <h1 className="topbar__title">MediaVault</h1>
            <p className="topbar__subtitle muted">Brand Asset Library</p>
          </div>
        </div>

        <StatsHeader />
      </header>

      <FilterBar
        q={q}
        status={status}
        kind={kind}
        sort={sort}
        totalCount={total}
        loadedCount={items.length}
        isLoading={isLoadingInitial}
        onSearchChange={handleSearchChange}
        onStatusChange={handleStatusChange}
        onKindChange={handleKindChange}
        onSortChange={handleSortChange}
        onResetFilters={handleResetFilters}
      />

      {selectedIds.size > 0 && (
        <BulkBar
          selectedIds={selectedIds}
          totalLoaded={items.length}
          assets={items}
          onClearSelection={handleClearSelection}
          onSelectAllLoaded={handleSelectAllLoaded}
          onOptimisticApply={applyOptimisticStatus}
          onRollback={rollbackStatus}
          onAnnounce={setAnnouncement}
        />
      )}

      <main className="content">
        <ErrorBoundary fallbackTitle="Failed to render asset grid" onReset={refresh}>
          <AssetGrid
            assets={items}
            selectedIds={selectedIds}
            activeId={activeId}
            isLoadingInitial={isLoadingInitial}
            isLoadingMore={isLoadingMore}
            error={error}
            hasMore={hasMore}
            lastSelectedId={lastSelectedId}
            onToggleSelect={handleToggleSelect}
            onRangeSelect={handleRangeSelect}
            onOpen={handleOpenDetail}
            onLoadMore={loadMore}
            onRetry={refresh}
            onResetFilters={handleResetFilters}
          />
        </ErrorBoundary>

        {activeId && (
          <ErrorBoundary fallbackTitle="Failed to render asset details">
            <AssetDetail
              id={activeId}
              onClose={handleCloseDetail}
              onSaved={handleSaved}
              triggerElement={activeTriggerRef.current}
            />
          </ErrorBoundary>
        )}
      </main>

      <LiveRegion message={announcement} debounceMs={350} />
    </div>
  );
}
