import { useEffect, useLayoutEffect, useRef, useState } from 'react';

interface UseVirtualGridOptions {
  totalItems: number;
  minColWidth?: number;
  gap?: number;
  estimatedRowHeight?: number;
  overscan?: number;
  onNearBottom?: () => void;
  nearBottomThresholdPx?: number;
}

export function useVirtualGrid({
  totalItems,
  minColWidth = 230,
  gap = 16,
  estimatedRowHeight = 280,
  overscan = 2,
  onNearBottom,
  nearBottomThresholdPx = 400,
}: UseVirtualGridOptions) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(800);
  const [containerHeight, setContainerHeight] = useState(600);
  const [scrollTop, setScrollTop] = useState(0);

  // Measure container dimensions with ResizeObserver
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0) setContainerWidth(width);
        if (height > 0) setContainerHeight(height);
      }
    });

    ro.observe(el);
    setContainerWidth(el.clientWidth || 800);
    setContainerHeight(el.clientHeight || 600);

    return () => ro.disconnect();
  }, []);

  // Track scroll position
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let ticking = false;

    function handleScroll() {
      if (!ticking) {
        requestAnimationFrame(() => {
          if (el) {
            const currentScrollTop = el.scrollTop;
            setScrollTop(currentScrollTop);

            const scrollBottom = currentScrollTop + el.clientHeight;
            const scrollHeight = el.scrollHeight;

            if (
              scrollHeight > 0 &&
              scrollBottom >= scrollHeight - nearBottomThresholdPx &&
              onNearBottom
            ) {
              onNearBottom();
            }
          }
          ticking = false;
        });
        ticking = true;
      }
    }

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [onNearBottom, nearBottomThresholdPx]);

  // Compute layout
  const availableWidth = Math.max(containerWidth - gap * 2, minColWidth);
  const columns = Math.max(1, Math.floor((availableWidth + gap) / (minColWidth + gap)));
  const totalRows = Math.ceil(totalItems / columns);
  const rowHeight = estimatedRowHeight + gap;
  const totalHeight = totalRows * rowHeight;

  // Compute visible rows
  const startRow = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const endRow = Math.min(
    totalRows - 1,
    Math.ceil((scrollTop + containerHeight) / rowHeight) + overscan,
  );

  const visibleRows: Array<{
    rowIndex: number;
    top: number;
    startIndex: number;
    endIndex: number;
  }> = [];

  for (let r = startRow; r <= endRow && r < totalRows; r++) {
    const s = r * columns;
    const e = Math.min(totalItems, s + columns);
    visibleRows.push({
      rowIndex: r,
      top: r * rowHeight,
      startIndex: s,
      endIndex: e,
    });
  }

  return {
    containerRef,
    columns,
    totalRows,
    totalHeight,
    visibleRows,
    rowHeight,
  };
}
