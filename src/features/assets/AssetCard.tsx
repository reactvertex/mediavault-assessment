import React, { useState } from 'react';
import { thumbnailUrl } from '@/api/client';
import { formatBytes, formatDate, formatDuration, KIND_ICONS, STATUS_ICONS, statusLabel } from '@/lib/format';
import type { Asset } from '@/lib/types';

interface Props {
  asset: Asset;
  isSelected: boolean;
  isActive: boolean;
  tabIndex: number;
  onSelect: (id: string, shiftKey: boolean) => void;
  onOpen: (id: string) => void;
  onFocus: (id: string) => void;
  cardRef?: (node: HTMLDivElement | null) => void;
}

export const AssetCard = React.memo(
  function AssetCard({
    asset,
    isSelected,
    isActive,
    tabIndex,
    onSelect,
    onOpen,
    onFocus,
    cardRef,
  }: Props) {
    const [imgFailed, setImgFailed] = useState(false);

    const hasLegalHold = asset.tags.includes('legal-hold');

    return (
      <div
        ref={cardRef}
        role="gridcell"
        tabIndex={tabIndex}
        aria-selected={isSelected}
        aria-label={`${asset.name}, ${asset.kind}, ${statusLabel(asset.status)}`}
        className={
          'card' +
          (isSelected ? ' card--selected' : '') +
          (isActive ? ' card--active' : '') +
          (hasLegalHold ? ' card--legal-hold' : '')
        }
        onClick={() => onOpen(asset.id)}
        onFocus={() => onFocus(asset.id)}
        onKeyDown={(e) => {
          if (e.key === ' ') {
            e.preventDefault();
            onSelect(asset.id, e.shiftKey);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            onOpen(asset.id);
          }
        }}
      >
        <div className="card__media">
          {!asset.hasThumbnail || imgFailed ? (
            <div className="card__placeholder" aria-hidden="true">
              <span className="card__placeholder-icon">{KIND_ICONS[asset.kind]}</span>
              <span className="card__placeholder-id">{asset.id}</span>
            </div>
          ) : (
            <img
              className="card__thumb"
              src={thumbnailUrl(asset.id)}
              alt=""
              loading="lazy"
              aria-hidden="true"
              onError={() => setImgFailed(true)}
            />
          )}

          <label
            className="card__check-label"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              className="card__check"
              checked={isSelected}
              aria-label={`Select ${asset.name}`}
              onChange={(e) => onSelect(asset.id, (e.nativeEvent as MouseEvent).shiftKey)}
            />
          </label>

          {asset.durationSec && (
            <span className="card__duration" aria-hidden="true">
              {formatDuration(asset.durationSec)}
            </span>
          )}
        </div>

        <div className="card__body">
          <p className="card__name" title={asset.name}>
            {asset.name}
          </p>

          <p className="card__meta muted">
            <span className="card__kind">{asset.kind}</span>
            <span className="card__meta-sep">·</span>
            <span>{formatBytes(asset.sizeBytes)}</span>
            <span className="card__meta-sep">·</span>
            <span>{formatDate(asset.updatedAt)}</span>
          </p>

          <div className="card__footer">
            <span
              className={`pill pill--${asset.status}`}
              aria-label={`Status: ${statusLabel(asset.status)}`}
            >
              <span className="pill__icon" aria-hidden="true">
                {STATUS_ICONS[asset.status]}
              </span>
              <span className="pill__label">{statusLabel(asset.status)}</span>
            </span>

            {hasLegalHold && (
              <span className="pill pill--warning" title="Asset is on legal hold">
                <span aria-hidden="true">⚖️</span> Legal Hold
              </span>
            )}
          </div>
        </div>
      </div>
    );
  },
  (prev, next) =>
    prev.asset === next.asset &&
    prev.isSelected === next.isSelected &&
    prev.isActive === next.isActive &&
    prev.tabIndex === next.tabIndex,
);
