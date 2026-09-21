import { useState } from 'react';
import { bulkSetStatus } from '@/api/client';
import { statusLabel } from '@/lib/format';
import type { Asset, AssetStatus, BulkResult } from '@/lib/types';

const STATUSES: AssetStatus[] = ['draft', 'in_review', 'approved', 'archived'];

interface BulkFailureDetails {
  appliedCount: number;
  failedItems: Array<{
    id: string;
    name?: string;
    code: string;
    message?: string;
    isRetryable: boolean;
  }>;
  targetStatus: AssetStatus;
  appliedRollbackSnapshot: Map<string, AssetStatus>;
}

interface Props {
  selectedIds: Set<string>;
  totalLoaded: number;
  assets: Asset[];
  onClearSelection: () => void;
  onSelectAllLoaded: () => void;
  onOptimisticApply: (ids: string[], status: AssetStatus) => Map<string, AssetStatus>;
  onRollback: (snapshot: Map<string, AssetStatus>) => void;
  onAnnounce: (message: string) => void;
}

export function BulkBar({
  selectedIds,
  totalLoaded,
  assets,
  onClearSelection,
  onSelectAllLoaded,
  onOptimisticApply,
  onRollback,
  onAnnounce,
}: Props) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [failureReport, setFailureReport] = useState<BulkFailureDetails | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);

  const selectedCount = selectedIds.size;
  const isAllLoadedSelected = totalLoaded > 0 && selectedCount === totalLoaded;

  async function handleApplyStatus(targetStatus: AssetStatus, idsToUpdate?: string[]) {
    const ids = idsToUpdate || Array.from(selectedIds);
    if (ids.length === 0) return;

    setIsProcessing(true);
    setFailureReport(null);

    // 1. Optimistically apply to grid and get snapshot of previous states
    const snapshot = onOptimisticApply(ids, targetStatus);
    onAnnounce(`Updating ${ids.length} assets to ${statusLabel(targetStatus)}…`);

    try {
      // 2. Execute chunked batch with bounded concurrency via client
      const bulkResult: BulkResult = await bulkSetStatus(ids, targetStatus);

      // 3. Process outcomes
      if (bulkResult.failed === 0) {
        onAnnounce(`Successfully updated all ${bulkResult.applied} assets to ${statusLabel(targetStatus)}.`);
        if (!idsToUpdate) onClearSelection();
      } else {
        // Partial success (207) or total failure
        const rollbackForFailures = new Map<string, AssetStatus>();
        const failedItems: BulkFailureDetails['failedItems'] = [];
        const appliedRollbackSnapshot = new Map<string, AssetStatus>();

        for (const item of bulkResult.results) {
          if (!item.ok) {
            // Roll back ONLY failed assets
            const originalStatus = snapshot.get(item.id);
            if (originalStatus) {
              rollbackForFailures.set(item.id, originalStatus);
            }
            const assetObj = assets.find((a) => a.id === item.id);
            const isRetryable = item.code === 'conflict';

            failedItems.push({
              id: item.id,
              name: assetObj?.name,
              code: item.code,
              message:
                item.code === 'legal_hold'
                  ? 'Asset is on legal hold and cannot be modified'
                  : item.code === 'conflict'
                    ? 'Concurrent write conflict'
                    : item.message || 'Operation failed',
              isRetryable,
            });
          } else {
            // Keep track of applied ones in case user wants to Undo
            const originalStatus = snapshot.get(item.id);
            if (originalStatus) {
              appliedRollbackSnapshot.set(item.id, originalStatus);
            }
          }
        }

        // Roll back the failed items
        onRollback(rollbackForFailures);

        setFailureReport({
          appliedCount: bulkResult.applied,
          failedItems,
          targetStatus,
          appliedRollbackSnapshot,
        });

        onAnnounce(
          `Bulk update partially completed: ${bulkResult.applied} succeeded, ${bulkResult.failed} failed.`,
        );

        if (!idsToUpdate) {
          // Keep only failed IDs selected so user can see them
          onClearSelection();
        }
      }
    } catch (err) {
      // Unexpected total error: roll back everything
      onRollback(snapshot);
      onAnnounce(`Bulk update failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleRetryConflictFailures() {
    if (!failureReport) return;
    const retryableIds = failureReport.failedItems
      .filter((item) => item.isRetryable)
      .map((item) => item.id);

    if (retryableIds.length === 0) return;

    setIsRetrying(true);
    await handleApplyStatus(failureReport.targetStatus, retryableIds);
    setIsRetrying(false);
  }

  function handleUndoApplied() {
    if (!failureReport) return;
    onRollback(failureReport.appliedRollbackSnapshot);
    onAnnounce(`Reverted ${failureReport.appliedCount} updated assets to previous status.`);
    setFailureReport(null);
  }

  return (
    <>
      <div className="bulkbar" role="toolbar" aria-label="Bulk actions toolbar">
        <div className="bulkbar__info">
          <span className="bulkbar__count">
            <strong>{selectedCount}</strong> {selectedCount === 1 ? 'asset' : 'assets'} selected
          </span>
          <button
            type="button"
            className="btn btn--subtle btn--sm"
            onClick={isAllLoadedSelected ? onClearSelection : onSelectAllLoaded}
          >
            {isAllLoadedSelected ? 'Deselect all' : `Select all loaded (${totalLoaded})`}
          </button>
        </div>

        <div className="bulkbar__actions">
          <span className="bulkbar__label muted">Set status:</span>
          {STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              className="btn btn--sm"
              disabled={isProcessing}
              onClick={() => handleApplyStatus(status)}
            >
              {statusLabel(status)}
            </button>
          ))}
          <button
            type="button"
            className="btn btn--subtle btn--sm"
            disabled={isProcessing}
            onClick={onClearSelection}
          >
            Clear selection
          </button>
        </div>
      </div>

      {failureReport && (
        <div
          className="bulk-report-card"
          role="region"
          aria-label="Bulk operation results and failures"
        >
          <div className="bulk-report-card__header">
            <span className="bulk-report-card__title">
              ⚠️ {failureReport.appliedCount} updated, {failureReport.failedItems.length} failed
            </span>
            <div className="bulk-report-card__header-actions">
              {failureReport.failedItems.some((i) => i.isRetryable) && (
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  disabled={isRetrying}
                  onClick={handleRetryConflictFailures}
                >
                  {isRetrying ? 'Retrying…' : 'Retry transient failures'}
                </button>
              )}
              {failureReport.appliedCount > 0 && (
                <button
                  type="button"
                  className="btn btn--subtle btn--sm"
                  onClick={handleUndoApplied}
                >
                  Undo applied
                </button>
              )}
              <button
                type="button"
                className="btn btn--subtle btn--sm"
                onClick={() => setFailureReport(null)}
                aria-label="Dismiss bulk report"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="bulk-report-card__list">
            {failureReport.failedItems.map((item) => (
              <div key={item.id} className="bulk-report-item">
                <span className="bulk-report-item__id font-mono">{item.id}</span>
                <span className="bulk-report-item__name">{item.name || 'Unknown asset'}</span>
                <span className={`bulk-report-item__badge badge--${item.code}`}>
                  {item.message}
                </span>
                <span className="bulk-report-item__advice muted">
                  {item.code === 'legal_hold'
                    ? '(Permanent - exempt from bulk edits)'
                    : '(Transient conflict - can be retried)'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
