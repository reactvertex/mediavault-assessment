import { useEffect, useState } from 'react';

interface Props {
  onStatusChange?: (isOnline: boolean) => void;
}

export function OfflineBanner({ onStatusChange }: Props) {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [justReconnected, setJustReconnected] = useState(false);

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true);
      setJustReconnected(true);
      onStatusChange?.(true);
      const timer = setTimeout(() => {
        setJustReconnected(false);
      }, 4000);
      return () => clearTimeout(timer);
    }

    function handleOffline() {
      setIsOnline(false);
      setJustReconnected(false);
      onStatusChange?.(false);
    }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [onStatusChange]);

  if (isOnline && !justReconnected) return null;

  if (!isOnline) {
    return (
      <div className="status-banner status-banner--offline" role="status">
        <span className="status-banner__icon" aria-hidden="true">⚡</span>
        <span>
          <strong>You are currently offline.</strong> Requests are paused until connection returns.
        </span>
      </div>
    );
  }

  return (
    <div className="status-banner status-banner--reconnected" role="status">
      <span className="status-banner__icon" aria-hidden="true">✓</span>
      <span>Connection restored. Syncing with library…</span>
    </div>
  );
}
