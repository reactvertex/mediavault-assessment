import type { Asset } from '@/lib/types';

type AssetUpdateListener = (asset: Asset) => void;

/**
 * Server-Sent Events client for /api/events.
 * Reconnects cleanly and distributes asset.updated events to subscribers.
 */
class AssetEventStream {
  private eventSource: EventSource | null = null;
  private listeners = new Set<AssetUpdateListener>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isConnecting = false;

  subscribe(listener: AssetUpdateListener): () => void {
    this.listeners.add(listener);
    if (!this.eventSource && !this.isConnecting) {
      this.connect();
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.disconnect();
      }
    };
  }

  private connect() {
    if (typeof window === 'undefined' || !window.EventSource) return;
    this.isConnecting = true;

    try {
      this.eventSource = new EventSource('/api/events');

      this.eventSource.addEventListener('asset.updated', (e: MessageEvent) => {
        try {
          const asset = JSON.parse(e.data) as Asset;
          this.listeners.forEach((listener) => {
            try {
              listener(asset);
            } catch (err) {
              console.error('Error in asset update listener', err);
            }
          });
        } catch (err) {
          console.error('Failed to parse SSE payload', err);
        }
      });

      this.eventSource.onopen = () => {
        this.isConnecting = false;
      };

      this.eventSource.onerror = () => {
        this.isConnecting = false;
        this.disconnect();
        // Exponential backoff or wait 3s before retrying
        if (this.listeners.size > 0 && !this.reconnectTimer) {
          this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
          }, 3000);
        }
      };
    } catch {
      this.isConnecting = false;
    }
  }

  private disconnect() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

export const assetEvents = new AssetEventStream();
