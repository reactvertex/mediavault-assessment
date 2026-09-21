import { useEffect, useState } from 'react';
import { KIND_ICONS, STATUS_ICONS, statusLabel } from '@/lib/format';
import type { AssetKind, AssetQuery, AssetStatus } from '@/lib/types';

const STATUSES: AssetStatus[] = ['draft', 'in_review', 'approved', 'archived'];
const KINDS: AssetKind[] = ['image', 'video', 'document'];

const SORTS: Array<{ value: NonNullable<AssetQuery['sort']>; label: string }> = [
  { value: 'updatedAt:desc', label: 'Recently updated' },
  { value: 'updatedAt:asc', label: 'Oldest updated' },
  { value: 'name:asc', label: 'Name A–Z' },
  { value: 'name:desc', label: 'Name Z–A' },
  { value: 'sizeBytes:desc', label: 'Largest size' },
  { value: 'createdAt:desc', label: 'Newest created' },
];

interface Props {
  q: string;
  status: AssetStatus[];
  kind: AssetKind[];
  sort: NonNullable<AssetQuery['sort']>;
  totalCount: number;
  loadedCount: number;
  isLoading: boolean;
  onSearchChange: (query: string) => void;
  onStatusChange: (statuses: AssetStatus[]) => void;
  onKindChange: (kinds: AssetKind[]) => void;
  onSortChange: (sort: NonNullable<AssetQuery['sort']>) => void;
  onResetFilters: () => void;
}

export function FilterBar({
  q,
  status,
  kind,
  sort,
  totalCount,
  loadedCount,
  isLoading,
  onSearchChange,
  onStatusChange,
  onKindChange,
  onSortChange,
  onResetFilters,
}: Props) {
  // Local input state for immediate typing feedback
  const [localInput, setLocalInput] = useState(q);

  // Sync external changes to local input
  useEffect(() => {
    setLocalInput(q);
  }, [q]);

  // Debounce user typing by 300ms to prevent rate limiting (80 requests per 10s)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (localInput !== q) {
        onSearchChange(localInput);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [localInput, q, onSearchChange]);

  const hasActiveFilters = q.length > 0 || status.length > 0 || kind.length > 0 || sort !== 'updatedAt:desc';

  function toggleStatus(target: AssetStatus) {
    if (status.includes(target)) {
      onStatusChange(status.filter((s) => s !== target));
    } else {
      onStatusChange([...status, target]);
    }
  }

  function toggleKind(target: AssetKind) {
    if (kind.includes(target)) {
      onKindChange(kind.filter((k) => k !== target));
    } else {
      onKindChange([...kind, target]);
    }
  }

  return (
    <div className="filter-panel" role="search" aria-label="Asset filters">
      <div className="filter-panel__top">
        <div className="search-box">
          <span className="search-box__icon" aria-hidden="true">🔍</span>
          <input
            type="search"
            className="search-input"
            placeholder="Search assets by name or tag…"
            value={localInput}
            aria-label="Search assets by name or tag"
            onChange={(e) => setLocalInput(e.target.value)}
          />
          {localInput && (
            <button
              type="button"
              className="search-box__clear"
              aria-label="Clear search input"
              onClick={() => {
                setLocalInput('');
                onSearchChange('');
              }}
            >
              ✕
            </button>
          )}
        </div>

        <div className="sort-control">
          <label htmlFor="sort-select" className="sort-control__label muted">
            Sort by:
          </label>
          <select
            id="sort-select"
            className="sort-select"
            value={sort}
            onChange={(e) => onSortChange(e.target.value as NonNullable<AssetQuery['sort']>)}
          >
            {SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-panel__count muted" aria-live="polite">
          {isLoading && loadedCount === 0 ? (
            <span>Loading…</span>
          ) : (
            <span>
              Showing <strong>{loadedCount.toLocaleString()}</strong> of{' '}
              <strong>{totalCount.toLocaleString()}</strong> assets
            </span>
          )}
        </div>
      </div>

      <div className="filter-panel__bottom">
        <div className="filter-group" role="group" aria-label="Filter by status">
          <span className="filter-group__title muted">Status:</span>
          {STATUSES.map((s) => {
            const isChecked = status.includes(s);
            return (
              <label key={s} className={`filter-chip ${isChecked ? 'filter-chip--active' : ''}`}>
                <input
                  type="checkbox"
                  className="filter-chip__checkbox"
                  checked={isChecked}
                  onChange={() => toggleStatus(s)}
                />
                <span className="filter-chip__icon" aria-hidden="true">
                  {STATUS_ICONS[s]}
                </span>
                <span>{statusLabel(s)}</span>
              </label>
            );
          })}
        </div>

        <div className="filter-group" role="group" aria-label="Filter by asset kind">
          <span className="filter-group__title muted">Kind:</span>
          {KINDS.map((k) => {
            const isChecked = kind.includes(k);
            return (
              <label key={k} className={`filter-chip ${isChecked ? 'filter-chip--active' : ''}`}>
                <input
                  type="checkbox"
                  className="filter-chip__checkbox"
                  checked={isChecked}
                  onChange={() => toggleKind(k)}
                />
                <span className="filter-chip__icon" aria-hidden="true">
                  {KIND_ICONS[k]}
                </span>
                <span className="capitalize">{k}</span>
              </label>
            );
          })}
        </div>

        {hasActiveFilters && (
          <button
            type="button"
            className="btn btn--subtle btn--sm filter-reset-btn"
            onClick={onResetFilters}
          >
            Reset filters
          </button>
        )}
      </div>
    </div>
  );
}
