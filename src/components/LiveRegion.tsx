import { useEffect, useState } from 'react';

interface Props {
  message: string | null;
  debounceMs?: number;
}

/**
 * Accessible polite ARIA live region for screen readers.
 * Debounces frequent updates (such as rapid filter results) to prevent verbal spamming.
 */
export function LiveRegion({ message, debounceMs = 300 }: Props) {
  const [announcedMessage, setAnnouncedMessage] = useState('');

  useEffect(() => {
    if (!message) return;

    const timer = setTimeout(() => {
      setAnnouncedMessage(message);
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [message, debounceMs]);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
    >
      {announcedMessage}
    </div>
  );
}
