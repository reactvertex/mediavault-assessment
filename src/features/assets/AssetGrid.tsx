import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Asset } from '@/lib/types';
import { AssetCard } from './AssetCard';
import { useVirtualGrid } from './useVirtualGrid';

interface Props {
  assets: Asset[];
  selectedIds: Set<string>;
  activeId: string | null;
  isLoadingInitial: boolean;
  isLoadingMore: boolean;
  error: string | null;
  onToggleSelect: (id: string, shiftKey?: boolean) => void;
  onRangeSelect: (startIndex: number, endIndex: number) => void;
  onOpen: (id: string) => void;
  onLoadMore: () => void;
  onRetry?: () => void;
  onResetFilters?: () => void;
  hasMore: boolean;
  lastSelectedId?: string | null;
}

export function AssetGrid({
  assets,
  selectedIds,
  activeId,
  isLoadingInitial,
  isLoadingMore,
  error,
  onToggleSelect,
  onRangeSelect,
  onOpen,
  onLoadMore,
  onRetry,
  onResetFilters,
  hasMore,
  lastSelectedId,
}: Props) {
  const [focusedIndex, setFocusedIndex] = useState(0);
  const cardRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const anchorIndexRef = useRef<number>(0);

  // Keep focused index within bounds when assets change
  useEffect(() => {
    if (focusedIndex >= assets.length && assets.length > 0) {
      setFocusedIndex(assets.length - 1);
    }
  }, [assets.length, focusedIndex]);

  // Virtual grid calculation
  const { containerRef, columns, totalHeight, visibleRows, rowHeight } = useVirtualGrid({
    totalItems: assets.length,
    minColWidth: 230,
    gap: 16,
    estimatedRowHeight: 280,
    overscan: 2,
    onNearBottom: hasMore && !isLoadingMore ? onLoadMore : undefined,
  });

  // Focus a specific card and scroll into view if needed
  const focusCard = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(assets.length - 1, index));
      setFocusedIndex(clamped);

      // Scroll container to keep focused row in view
      const targetRow = Math.floor(clamped / columns);
      const targetTop = targetRow * (rowHeight + 16);
      const container = containerRef.current;
      if (container) {
        if (targetTop < container.scrollTop) {
          container.scrollTop = targetTop;
        } else if (targetTop + rowHeight > container.scrollTop + container.clientHeight) {
          container.scrollTop = targetTop + rowHeight - container.clientHeight + 16;
        }
      }

      // Try focusing DOM node
      requestAnimationFrame(() => {
        const el = cardRefs.current.get(clamped);
        if (el) {
          el.focus();
        }
      });
    },
    [assets.length, columns, rowHeight, containerRef],
  );

  // Handle single and range selection
  const handleSelect = useCallback(
    (id: string, shiftKey = false) => {
      const clickedIndex = assets.findIndex((a) => a.id === id);
      if (clickedIndex === -1) return;

      if (shiftKey && lastSelectedId) {
        const lastIdx = assets.findIndex((a) => a.id === lastSelectedId);
        if (lastIdx !== -1) {
          onRangeSelect(Math.min(lastIdx, clickedIndex), Math.max(lastIdx, clickedIndex));
          return;
        }
      }

      anchorIndexRef.current = clickedIndex;
      onToggleSelect(id, shiftKey);
    },
    [assets, lastSelectedId, onRangeSelect, onToggleSelect],
  );

  // Keyboard navigation on grid container
  const handleGridKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (assets.length === 0) return;

      let nextIndex = focusedIndex;
      let handled = false;

      switch (e.key) {
        case 'ArrowRight':
          nextIndex = Math.min(assets.length - 1, focusedIndex + 1);
          handled = true;
          break;
        case 'ArrowLeft':
          nextIndex = Math.max(0, focusedIndex - 1);
          handled = true;
          break;
        case 'ArrowDown':
          nextIndex = Math.min(assets.length - 1, focusedIndex + columns);
          handled = true;
          break;
        case 'ArrowUp':
          nextIndex = Math.max(0, focusedIndex - columns);
          handled = true;
          break;
        case 'Home':
          nextIndex = 0;
          handled = true;
          break;
        case 'End':
          nextIndex = assets.length - 1;
          handled = true;
          break;
        case ' ': // Space
          e.preventDefault();
          if (assets[focusedIndex]) {
            handleSelect(assets[focusedIndex].id, e.shiftKey);
          }
          return;
        case 'Enter':
          e.preventDefault();
          if (assets[focusedIndex]) {
            onOpen(assets[focusedIndex].id);
          }
          return;
      }

      if (handled) {
        e.preventDefault();
        if (e.shiftKey) {
          // Range selection with Shift + Arrow
          const start = Math.min(anchorIndexRef.current, nextIndex);
          const end = Math.max(anchorIndexRef.current, nextIndex);
          onRangeSelect(start, end);
        } else {
          anchorIndexRef.current = nextIndex;
        }
        focusCard(nextIndex);
      }
    },
    [assets, columns, focusCard, focusedIndex, handleSelect, onOpen, onRangeSelect],
  );

  // Initial loading skeleton state
  if (isLoadingInitial) {
    return (
      <div className="grid-scroll-area">
        <div className="grid grid--skeleton" aria-label="Loading assets…">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="card card--skeleton" aria-hidden="true">
              <div className="card__media skeleton-box" />
              <div className="card__body">
                <div className="skeleton-line skeleton-line--title" />
                <div className="skeleton-line skeleton-line--meta" />
                <div className="skeleton-line skeleton-line--pill" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Error state when no items loaded
  if (error && assets.length === 0) {
    return (
      <div className="grid-scroll-area">
        <div className="state-card state-card--error" role="alert">
          <div className="state-card__icon" aria-hidden="true">⚠️</div>
          <h3>Failed to load assets</h3>
          <p className="muted">{error}</p>
          {onRetry && (
            <button className="btn btn--primary" onClick={onRetry}>
              Retry request
            </button>
          )}
        </div>
      </div>
    );
  }

  // Empty state
  if (!isLoadingInitial && assets.length === 0) {
    return (
      <div className="grid-scroll-area">
        <div className="state-card state-card--empty">
          <div className="state-card__icon" aria-hidden="true">🔍</div>
          <h3>No assets found</h3>
          <p className="muted">
            No assets match the active search and filter criteria. Try clearing search keywords or
            enabling more status options.
          </p>
          {onResetFilters && (
            <button className="btn btn--secondary" onClick={onResetFilters}>
              Reset all filters
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="grid-scroll-area"
      tabIndex={-1}
      role="grid"
      aria-label="Media asset library"
      aria-rowcount={assets.length}
      onKeyDown={handleGridKeyDown}
    >
      <div
        className="virtual-grid-container"
        style={{ height: `${totalHeight}px`, position: 'relative' }}
      >
        {visibleRows.map((row) => (
          <div
            key={row.rowIndex}
            role="row"
            className="virtual-row"
            style={{
              position: 'absolute',
              top: `${row.top}px`,
              left: 0,
              right: 0,
              height: `${rowHeight}px`,
              display: 'grid',
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              gap: '16px',
            }}
          >
            {assets.slice(row.startIndex, row.endIndex).map((asset, colOffset) => {
              const itemIndex = row.startIndex + colOffset;
              const isSelected = selectedIds.has(asset.id);
              const isActive = activeId === asset.id;
              const tabIndex = itemIndex === focusedIndex ? 0 : -1;

              return (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  isSelected={isSelected}
                  isActive={isActive}
                  tabIndex={tabIndex}
                  onSelect={handleSelect}
                  onOpen={onOpen}
                  onFocus={() => setFocusedIndex(itemIndex)}
                  cardRef={(el) => {
                    if (el) cardRefs.current.set(itemIndex, el);
                    else cardRefs.current.delete(itemIndex);
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>

      {isLoadingMore && (
        <div className="loading-more-indicator" role="status" aria-label="Loading more assets">
          <span className="spinner" aria-hidden="true" />
          <span>Loading more assets…</span>
        </div>
      )}
    </div>
  );
}
