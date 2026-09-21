import { useEffect, useRef, useState } from 'react';
import { getAsset, thumbnailUrl, updateAsset } from '@/api/client';
import { ApiError, getFriendlyErrorMessage } from '@/lib/errors';
import {
  formatBytes,
  formatDate,
  formatDuration,
  KIND_ICONS,
  STATUS_ICONS,
  statusLabel,
} from '@/lib/format';
import type { Asset, AssetStatus } from '@/lib/types';

const STATUSES: AssetStatus[] = ['draft', 'in_review', 'approved', 'archived'];

interface ConflictData {
  serverAsset: Asset;
  intendedStatus?: AssetStatus;
  intendedName?: string;
}

interface Props {
  id: string;
  onClose: () => void;
  onSaved: (asset: Asset) => void;
  triggerElement?: HTMLElement | null;
}

export function AssetDetail({ id, onClose, onSaved, triggerElement }: Props) {
  const [asset, setAsset] = useState<Asset | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const [conflict, setConflict] = useState<ConflictData | null>(null);

  const panelRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  // Focus management: move focus into panel on mount, restore trigger on unmount
  useEffect(() => {
    // Focus close button on mount
    requestAnimationFrame(() => {
      closeButtonRef.current?.focus();
    });

    return () => {
      // Restore focus to trigger card on close
      triggerElement?.focus();
    };
  }, [triggerElement]);

  // Escape key closes panel
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Load asset details
  useEffect(() => {
    let active = true;
    const ac = new AbortController();

    setLoading(true);
    setError(null);
    setConflict(null);
    setImgFailed(false);

    getAsset(id, ac.signal)
      .then((data) => {
        if (!active) return;
        setAsset(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active || (err instanceof DOMException && err.name === 'AbortError')) return;
        setError(getFriendlyErrorMessage(err));
        setLoading(false);
      });

    return () => {
      active = false;
      ac.abort();
    };
  }, [id]);

  async function handleUpdateStatus(newStatus: AssetStatus, forcedVersion?: number) {
    if (!asset) return;
    setSaving(true);
    setError(null);
    setConflict(null);

    const versionToUse = forcedVersion !== undefined ? forcedVersion : asset.version;

    try {
      const updated = await updateAsset(asset.id, versionToUse, { status: newStatus });
      setAsset(updated);
      onSaved(updated);
    } catch (err: unknown) {
      if (err instanceof ApiError && (err.status === 409 || err.code === 'version_conflict')) {
        // Fetch latest server asset to resolve conflict
        try {
          const fresh = await getAsset(asset.id);
          setConflict({
            serverAsset: fresh,
            intendedStatus: newStatus,
          });
        } catch {
          setError('Version conflict: The asset changed on the server, but could not refetch.');
        }
      } else {
        setError(getFriendlyErrorMessage(err));
      }
    } finally {
      setSaving(false);
    }
  }

  function handleAcceptServerVersion() {
    if (!conflict) return;
    setAsset(conflict.serverAsset);
    onSaved(conflict.serverAsset);
    setConflict(null);
  }

  function handleForceOverwrite() {
    if (!conflict || !conflict.intendedStatus) return;
    const targetStatus = conflict.intendedStatus;
    const latestVersion = conflict.serverAsset.version;
    setConflict(null);
    handleUpdateStatus(targetStatus, latestVersion);
  }

  const isLegalHold = asset?.tags.includes('legal-hold');

  return (
    <aside
      ref={panelRef}
      className="panel"
      role="dialog"
      aria-label={asset ? `Asset details for ${asset.name}` : 'Asset details'}
      aria-modal="false"
    >
      <div className="panel__head">
        <h2 className="panel__title">Asset detail</h2>
        <button
          ref={closeButtonRef}
          type="button"
          className="btn btn--subtle btn--sm"
          onClick={onClose}
          aria-label="Close detail panel"
        >
          ✕
        </button>
      </div>

      {loading && (
        <div className="panel__loading" role="status" aria-label="Loading asset details">
          <span className="spinner" aria-hidden="true" />
          <span className="muted">Loading asset details…</span>
        </div>
      )}

      {error && !loading && (
        <div className="panel-error" role="alert">
          <p className="panel-error__msg">{error}</p>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => {
              setError(null);
              setLoading(true);
              getAsset(id)
                .then(setAsset)
                .catch((e) => setError(getFriendlyErrorMessage(e)))
                .finally(() => setLoading(false));
            }}
          >
            Retry
          </button>
        </div>
      )}

      {conflict && (
        <div className="conflict-banner" role="alert">
          <div className="conflict-banner__header">
            <strong>⚠️ Version Conflict</strong>
          </div>
          <p className="conflict-banner__text">
            Another user updated this asset to <em>{statusLabel(conflict.serverAsset.status)}</em>{' '}
            (v{conflict.serverAsset.version}). Your edit targeted v{asset?.version}.
          </p>
          <div className="conflict-banner__actions">
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={handleForceOverwrite}
              disabled={saving}
            >
              Overwrite with my change
            </button>
            <button
              type="button"
              className="btn btn--subtle btn--sm"
              onClick={handleAcceptServerVersion}
            >
              Accept server version
            </button>
          </div>
        </div>
      )}

      {asset && !loading && (
        <div className="panel__body">
          <div className="panel__media">
            {!asset.hasThumbnail || imgFailed ? (
              <div className="panel__placeholder" aria-hidden="true">
                <span className="panel__placeholder-icon">{KIND_ICONS[asset.kind]}</span>
                <span className="panel__placeholder-id font-mono">{asset.id}</span>
              </div>
            ) : (
              <img
                className="panel__thumb"
                src={thumbnailUrl(asset.id)}
                alt=""
                onError={() => setImgFailed(true)}
              />
            )}
          </div>

          <h3 className="panel__asset-name">{asset.name}</h3>

          <div className="panel__section">
            <h4 className="panel__section-title">Status</h4>
            <div className="panel__status-row" role="group" aria-label="Change status">
              {STATUSES.map((status) => {
                const isCurrent = asset.status === status;
                const disabledForLegalHold = isLegalHold && status === 'archived';

                return (
                  <button
                    key={status}
                    type="button"
                    className={`btn btn--sm ${isCurrent ? 'btn--active' : ''}`}
                    disabled={saving || isCurrent || disabledForLegalHold}
                    onClick={() => handleUpdateStatus(status)}
                    title={
                      disabledForLegalHold
                        ? 'Assets on legal hold cannot be archived'
                        : `Set status to ${statusLabel(status)}`
                    }
                  >
                    <span aria-hidden="true">{STATUS_ICONS[status]}</span> {statusLabel(status)}
                  </button>
                );
              })}
            </div>
            {isLegalHold && (
              <p className="muted panel__hint">
                ⚖️ <strong>Legal Hold:</strong> This asset cannot be archived.
              </p>
            )}
          </div>

          <div className="panel__section">
            <h4 className="panel__section-title">Metadata</h4>
            <dl className="facts">
              <dt>ID</dt>
              <dd className="font-mono">{asset.id}</dd>

              <dt>Kind</dt>
              <dd>
                {KIND_ICONS[asset.kind]} {asset.kind}
              </dd>

              <dt>File Size</dt>
              <dd>{formatBytes(asset.sizeBytes)}</dd>

              {asset.width && asset.height && (
                <>
                  <dt>Dimensions</dt>
                  <dd>
                    {asset.width} × {asset.height} px
                  </dd>
                </>
              )}

              {asset.durationSec && (
                <>
                  <dt>Duration</dt>
                  <dd>{formatDuration(asset.durationSec)}</dd>
                </>
              )}

              <dt>Owner</dt>
              <dd>{asset.owner.name}</dd>

              <dt>Created</dt>
              <dd>{formatDate(asset.createdAt)}</dd>

              <dt>Updated</dt>
              <dd>{formatDate(asset.updatedAt)}</dd>

              <dt>Version</dt>
              <dd className="font-mono">v{asset.version}</dd>
            </dl>
          </div>

          {asset.tags.length > 0 && (
            <div className="panel__section">
              <h4 className="panel__section-title">Tags</h4>
              <ul className="tags" aria-label="Asset tags">
                {asset.tags.map((tag) => (
                  <li
                    key={tag}
                    className={`tag-pill ${tag === 'legal-hold' ? 'tag-pill--warning' : ''}`}
                  >
                    {tag === 'legal-hold' && <span aria-hidden="true">⚖️ </span>}
                    {tag}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
