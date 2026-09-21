import { useEffect, useState } from 'react';
import { getStats } from '@/api/client';
import { formatBytes } from '@/lib/format';

interface StatsData {
  total: number;
  byStatus: Record<string, number>;
  byKind: Record<string, number>;
  totalBytes: number;
}

export function StatsHeader() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    const ac = new AbortController();

    setLoading(true);
    // Asynchronously loads stats in the background without blocking the UI
    getStats(ac.signal)
      .then((data) => {
        if (active) setStats(data);
      })
      .catch(() => {
        // Stats failure should fail silently and not block user flow
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      ac.abort();
    };
  }, []);

  if (!stats && loading) {
    return (
      <div className="stats-bar stats-bar--loading muted" aria-label="Loading library statistics">
        <span className="stats-bar__pulse" /> Loading library metrics…
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="stats-bar" role="region" aria-label="Library overview statistics">
      <div className="stats-item">
        <span className="stats-label muted">Total Assets:</span>
        <span className="stats-value font-mono">{stats.total.toLocaleString()}</span>
      </div>
      <div className="stats-item">
        <span className="stats-label muted">Storage:</span>
        <span className="stats-value font-mono">{formatBytes(stats.totalBytes)}</span>
      </div>
      <div className="stats-item">
        <span className="stats-label muted">Approved:</span>
        <span className="stats-value font-mono text-emerald">
          {(stats.byStatus['approved'] ?? 0).toLocaleString()}
        </span>
      </div>
      <div className="stats-item">
        <span className="stats-label muted">In Review:</span>
        <span className="stats-value font-mono text-amber">
          {(stats.byStatus['in_review'] ?? 0).toLocaleString()}
        </span>
      </div>
    </div>
  );
}
